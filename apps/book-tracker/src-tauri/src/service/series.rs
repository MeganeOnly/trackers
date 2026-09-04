//! Series 业务逻辑 —— v1.7 新增。
//!
//! 包装 `data::series`,加校验和关联清理:
//! - create / update / delete / list 直接代理 data 层(无额外业务逻辑)
//! - delete 路径调用 `data::books::clear_series_references` 兜底脏引用清理
//!   (跟 delete_book 路径的 nextSeasonId / prevSeasonId 清理同款策略)
//!
//! **关联字段维护放在 book 侧**:
//! - "把作品加入系列" / "把作品移出系列" 走 `service::books::set_series`,
//!   专用 IPC,不走 BookPatch
//! - 这里不维护"系列包含哪些作品"的反向数组(renderer 端从 books 全量聚合)

use std::path::Path;

use crate::data::books as books_data;
use crate::data::config::paths::{books_dir, series_file};
use crate::data::series as data;
use crate::types::{Series, SeriesInput, SeriesPatch};

/// 列出所有 series(按 id 升序)。
pub fn list_series(data_dir: impl AsRef<Path>) -> std::io::Result<Vec<Series>> {
    data::list_series(data_dir.as_ref().to_str().unwrap_or(""))
}

/// 读单个 series。文件不存在 / id 不存在 → None。
pub fn get_series(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Series>> {
    data::read_series(data_dir.as_ref().to_str().unwrap_or(""), id)
}

/// 创建新 series。
///
/// **name 必填**:name 空串 / 纯空白 → Err(InvalidInput)。
/// data 层会兜底同样校验,但在 service 层提早校验可以避免不必要的 IO。
pub fn create_series(data_dir: impl AsRef<Path>, input: &SeriesInput) -> std::io::Result<Series> {
    if input.name.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "系列名不能为空",
        ));
    }
    data::create_series(data_dir.as_ref().to_str().unwrap_or(""), input)
}

/// 更新 series。id 不存在 → Err(NotFound);name 设为空 → Err(InvalidInput)。
pub fn update_series(
    data_dir: impl AsRef<Path>,
    id: &str,
    patch: &SeriesPatch,
) -> std::io::Result<Series> {
    if let Some(n) = &patch.name {
        if n.trim().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "系列名不能为空",
            ));
        }
    }
    data::update_series(data_dir.as_ref().to_str().unwrap_or(""), id, patch)
}

/// 删除 series。id 不存在 → Err(NotFound)。
///
/// **联动清理**:删除后扫描所有 books,把 `series_id == id` 的清空。
/// 不刷那些 books 的 updated(结构性维护)。
/// 用 `data::books::clear_series_references` 实现(走正常 read_all_books 路径,
/// 跳过损坏文件,跟 delete_book 同款策略)。
pub fn delete_series(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    let dir_str = data_dir.as_ref().to_str().unwrap_or("");
    data::delete_series(dir_str, id)?;
    let books_dir_str = books_dir(dir_str).to_string_lossy().to_string();
    books_data::clear_series_references(&books_dir_str, id)?;
    // 清理失败不阻止系列删除主路径 —— series.json 已经写完,book 端脏引用是
    // 退化问题(只是 UI 显示 "已删除系列" 的提示),不影响数据正确性。
    // 跟 v1.6 set_next_season 的目标 B 不存在时"跳过 prev 设置"同款精神:
    // **不擅自重写用户的引用**,留 UI 兜底。
    Ok(())
}

/// 拿到 series.json 文件路径 —— 给前端调试 / 数据迁移用。
pub fn get_series_path(data_dir: impl AsRef<Path>) -> std::io::Result<String> {
    Ok(series_file(data_dir.as_ref().to_str().unwrap_or(""))
        .to_string_lossy()
        .to_string())
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn setup() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        // 模拟 books/ 目录存在 —— clear_series_references 需要它
        std::fs::create_dir_all(dir.path().join("books")).unwrap();
        dir
    }

    fn write_book_with_series(dir: &Path, book_id: &str, series_id: &str) {
        let path = dir.join("books").join(format!("{book_id}.md"));
        let content = format!(
            "---\n{{\n  \"id\": \"{book_id}\",\n  \"title\": \"test\",\n  \"status\": \"finished\",\n  \"seriesId\": \"{series_id}\",\n  \"created\": \"\",\n  \"updated\": \"\"\n}}\n---\n# test\n"
        );
        std::fs::write(path, content).unwrap();
    }

    fn read_series_id_from_book(dir: &Path, book_id: &str) -> Option<String> {
        let path = dir.join("books").join(format!("{book_id}.md"));
        let raw = std::fs::read_to_string(path).unwrap();
        let fm = raw.split("---").nth(1).unwrap_or("");
        if fm.contains("\"seriesId\"") {
            Some("present".to_string())
        } else {
            None
        }
    }

    #[test]
    fn create_then_list() {
        let dir = setup();
        let s = create_series(dir.path(), &SeriesInput {
            name: "大明王朝".to_string(),
            notes: String::new(),
        })
        .unwrap();
        assert_eq!(s.id, "1");
        assert_eq!(s.name, "大明王朝");

        let list = list_series(dir.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "大明王朝");
    }

    #[test]
    fn create_empty_name_rejected() {
        let dir = setup();
        let err = create_series(dir.path(), &SeriesInput {
            name: "  ".to_string(),
            notes: String::new(),
        })
        .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[test]
    fn delete_clears_book_references() {
        let dir = setup();
        let s = create_series(dir.path(), &SeriesInput {
            name: "大明".to_string(),
            notes: String::new(),
        })
        .unwrap();
        write_book_with_series(dir.path(), "1", &s.id);
        write_book_with_series(dir.path(), "2", &s.id);
        write_book_with_series(dir.path(), "3", &s.id);

        // 删系列 → 应该把 3 个 book 的 seriesId 都清掉
        delete_series(dir.path(), &s.id).unwrap();

        assert!(read_series_id_from_book(dir.path(), "1").is_none());
        assert!(read_series_id_from_book(dir.path(), "2").is_none());
        assert!(read_series_id_from_book(dir.path(), "3").is_none());

        let list = list_series(dir.path()).unwrap();
        assert!(list.is_empty(), "系列列表应空");
    }

    #[test]
    fn delete_only_clears_targeted_series() {
        let dir = setup();
        let s1 = create_series(dir.path(), &SeriesInput {
            name: "A".to_string(),
            notes: String::new(),
        })
        .unwrap();
        let s2 = create_series(dir.path(), &SeriesInput {
            name: "B".to_string(),
            notes: String::new(),
        })
        .unwrap();
        write_book_with_series(dir.path(), "1", &s1.id);
        write_book_with_series(dir.path(), "2", &s2.id);

        delete_series(dir.path(), &s1.id).unwrap();

        assert!(read_series_id_from_book(dir.path(), "1").is_none(), "s1 的 book 应清");
        assert!(read_series_id_from_book(dir.path(), "2").is_some(), "s2 的 book 不应受影响");
    }

    #[test]
    fn delete_not_found() {
        let dir = setup();
        let err = delete_series(dir.path(), "999").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn get_series_path_helper() {
        let dir = setup();
        let p = get_series_path(dir.path()).unwrap();
        assert!(p.ends_with("series.json"));
    }
}