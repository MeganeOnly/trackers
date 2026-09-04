//! `series.json` 读写（v1.7 新增）。
//!
//! 文件位置：`<data_dir>/series.json`。
//!
//! **存储约定**：单文件存所有 series（`{ version, series: [...] }`）。
//! 成员关系**不**冗余存放在 Series 实体里 —— 各 book 的 `series_id` 字段
//! 是唯一来源，renderer 端从 books 全量聚合即可。理由：避免双向引用同步问题，
//! 跟 v1.6 nextSeasonId / prevSeasonId 同款单向策略。
//!
//! **文件缺失** → 返回默认空 `SeriesFile`（version=1、空 series 数组）。
//! **容错**：版本字段缺失 → 1；series 数组缺损 / 非数组 → 空数组。
//! 单条 series 字段缺失（id / name 缺一）→ 跳过该条（不抛错）—— 跟 books.rs
//! 容错策略一致，避免坏数据让整个 series.json 不可读。
//!
//! **写盘稀疏策略**（与 Book.notes / nextSeasonId 同款）：
//! - `name` 为空 → service 层校验拒绝创建（数据层不再兜底）
//! - `notes` 空 → 不写 frontmatter 字段
//! - 时间戳字段总是写（created / updated 是必填）

use std::collections::HashSet;
use std::path::Path;

use tracker_core::files::{atomic_write_file, read_json};
use tracker_core::frontmatter::now_iso;
use tracker_core::slug::make_base_id;

use crate::data::config::paths::series_file;
use crate::types::{Series, SeriesFile, SeriesInput, SeriesPatch};

/// 读 `<data_dir>/series.json`。文件不存在 → 默认空 SeriesFile。
///
/// 容错策略：
/// - version 缺损 / 0 → 1（`SeriesFile::default` 已处理）
/// - series 数组缺损 / 非数组 → 空数组
/// - 单条 series id / name 缺一不可（缺则跳过；name 空也跳过）
pub fn read_series_file(data_dir: impl AsRef<Path>) -> std::io::Result<SeriesFile> {
    let path = series_file(data_dir.as_ref().to_str().unwrap_or(""));
    let raw: SeriesFile = read_json(&path, SeriesFile::default())?;
    Ok(normalize_series_file(raw))
}

/// 把读回的 SeriesFile 容错纠正（保留 normalize 逻辑以便 service 层复用）。
fn normalize_series_file(raw: SeriesFile) -> SeriesFile {
    SeriesFile {
        version: if raw.version == 0 { 1 } else { raw.version },
        series: raw.series.into_iter().filter(|s| is_valid_series(s)).collect(),
    }
}

fn is_valid_series(s: &Series) -> bool {
    // id 非空 + name 非空 → 必填字段缺一不可
    !s.id.is_empty() && !s.name.is_empty()
}

/// 原子写 `<data_dir>/series.json`。
///
/// **稀疏策略**：notes 空 → 不写（等同 Book.notes）。name / id / created / updated
/// 是必填，总是写。**整体文件覆盖**（跟 relations.json 同款），不会逐字段合并。
pub fn write_series_file(
    data_dir: impl AsRef<Path>,
    file: &SeriesFile,
) -> std::io::Result<()> {
    // 兜底:写之前再过一遍 normalize,确保磁盘上没有"脏 series"
    let cleaned = SeriesFile {
        version: if file.version == 0 { 1 } else { file.version },
        series: file.series.iter().filter(|s| is_valid_series(s)).cloned().collect(),
    };
    let path = series_file(data_dir.as_ref().to_str().unwrap_or(""));
    let s = serde_json::to_string_pretty(&cleaned)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    atomic_write_file(&path, &(s + "\n"))
}

/// 列出所有 series（按 id 升序 / 数字序）。
///
/// 读 → normalize → 按 id 数值排序（保持稳定顺序便于 UI 展示）。
/// 数字 ID 走数值排序；非数字 ID（兜底）走字典序。
pub fn list_series(data_dir: impl AsRef<Path>) -> std::io::Result<Vec<Series>> {
    let file = read_series_file(data_dir)?;
    let mut series = file.series;
    series.sort_by(|a, b| {
        let a_num = a.id.parse::<u64>();
        let b_num = b.id.parse::<u64>();
        match (a_num, b_num) {
            (Ok(an), Ok(bn)) => an.cmp(&bn),
            _ => a.id.cmp(&b.id),
        }
    });
    Ok(series)
}

/// 读单个 series。文件不存在 / id 不存在 → None。
pub fn read_series(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Series>> {
    let all = list_series(data_dir)?;
    Ok(all.into_iter().find(|s| s.id == id))
}

/// 创建新 series —— 自动分配新 id（数字 ID，max+1）。
///
/// **name 必填**：name 空串视为非法,返回 Err(service 层兜底拒绝)。
///
/// 返回写后的 Series（含 id / created / updated）。
pub fn create_series(
    data_dir: impl AsRef<Path>,
    input: &SeriesInput,
) -> std::io::Result<Series> {
    if input.name.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "series name cannot be empty",
        ));
    }
    let mut file = read_series_file(data_dir.as_ref())?;
    let existing: HashSet<String> = file.series.iter().map(|s| s.id.clone()).collect();
    let id = make_base_id(existing.iter().map(String::as_str));
    let now = now_iso();
    let series = Series {
        id,
        name: input.name.trim().to_string(),
        notes: if input.notes.is_empty() { None } else { Some(input.notes.clone()) },
        created: now.clone(),
        updated: now,
    };
    file.series.push(series.clone());
    write_series_file(data_dir.as_ref(), &file)?;
    Ok(series)
}

/// 更新 series —— patch 合并。id 不存在 → Err(NotFound)。
///
/// **name 非空校验**:`patch.name = Some("")` 视为非法(不允许把名字清空,
/// 跟 create 保持一致)。允许通过 `notes: Some("")` 清空笔记。
pub fn update_series(
    data_dir: impl AsRef<Path>,
    id: &str,
    patch: &SeriesPatch,
) -> std::io::Result<Series> {
    if let Some(n) = &patch.name {
        if n.trim().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "series name cannot be empty",
            ));
        }
    }
    let mut file = read_series_file(data_dir.as_ref())?;
    let series = file
        .series
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("series not found: {id}")))?;
    if let Some(n) = &patch.name {
        series.name = n.trim().to_string();
    }
    if let Some(n) = &patch.notes {
        series.notes = if n.is_empty() { None } else { Some(n.clone()) };
    }
    series.updated = now_iso();
    let updated_series = series.clone();
    write_series_file(data_dir.as_ref(), &file)?;
    Ok(updated_series)
}

/// 删除 series。id 不存在 → Err(NotFound)。
///
/// **不**自动清理指向该 series 的 book —— service 层在 delete 时统一调用
/// `data::books::clear_series_references` 兜底（避免脏引用）。理由：保持
/// data 层"纯 IO"职责,关联清理放 service 层（跟 set_next_season 路径同款）。
pub fn delete_series(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    let mut file = read_series_file(data_dir.as_ref())?;
    let before = file.series.len();
    file.series.retain(|s| s.id != id);
    if file.series.len() == before {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, format!("series not found: {id}")));
    }
    write_series_file(data_dir.as_ref(), &file)?;
    Ok(())
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_input(name: &str) -> SeriesInput {
        SeriesInput {
            name: name.to_string(),
            notes: String::new(),
        }
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let f = read_series_file(dir.path()).unwrap();
        assert_eq!(f.version, 1);
        assert!(f.series.is_empty());
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let s = create_series(dir.path(), &sample_input("大明王朝")).unwrap();
        assert_eq!(s.id, "1");
        assert_eq!(s.name, "大明王朝");
        assert!(s.notes.is_none());
        let got = read_series(dir.path(), "1").unwrap().unwrap();
        assert_eq!(got.name, "大明王朝");
        assert_eq!(got.id, "1");
    }

    #[test]
    fn second_create_uses_next_id() {
        let dir = tempdir().unwrap();
        let s1 = create_series(dir.path(), &sample_input("A")).unwrap();
        let s2 = create_series(dir.path(), &sample_input("B")).unwrap();
        assert_eq!(s1.id, "1");
        assert_eq!(s2.id, "2");
    }

    #[test]
    fn create_empty_name_rejected() {
        let dir = tempdir().unwrap();
        let err = create_series(dir.path(), &sample_input("")).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
        let err2 = create_series(dir.path(), &sample_input("   ")).unwrap_err();
        assert_eq!(err2.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[test]
    fn list_returns_sorted_by_id() {
        let dir = tempdir().unwrap();
        create_series(dir.path(), &sample_input("A")).unwrap();
        create_series(dir.path(), &sample_input("B")).unwrap();
        let list = list_series(dir.path()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "1");
        assert_eq!(list[1].id, "2");
    }

    #[test]
    fn update_name_and_notes() {
        let dir = tempdir().unwrap();
        let s = create_series(dir.path(), &sample_input("A")).unwrap();
        let patch = SeriesPatch {
            name: Some("大明王朝".to_string()),
            notes: Some("剧集 + 衍生小说".to_string()),
        };
        let updated = update_series(dir.path(), &s.id, &patch).unwrap();
        assert_eq!(updated.name, "大明王朝");
        assert_eq!(updated.notes.as_deref(), Some("剧集 + 衍生小说"));
        assert!(updated.updated >= s.created, "updated should be refreshed");
    }

    #[test]
    fn update_empty_name_rejected() {
        let dir = tempdir().unwrap();
        let s = create_series(dir.path(), &sample_input("A")).unwrap();
        let patch = SeriesPatch {
            name: Some("".to_string()),
            notes: None,
        };
        let err = update_series(dir.path(), &s.id, &patch).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[test]
    fn update_notes_empty_clears() {
        let dir = tempdir().unwrap();
        let mut input = sample_input("A");
        input.notes = "初始简介".to_string();
        let s = create_series(dir.path(), &input).unwrap();
        let patch = SeriesPatch {
            name: None,
            notes: Some("".to_string()),
        };
        let updated = update_series(dir.path(), &s.id, &patch).unwrap();
        assert!(updated.notes.is_none(), "空串 notes 应清空");
    }

    #[test]
    fn update_not_found() {
        let dir = tempdir().unwrap();
        let patch = SeriesPatch {
            name: Some("X".to_string()),
            notes: None,
        };
        let err = update_series(dir.path(), "999", &patch).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn delete_removes_from_file() {
        let dir = tempdir().unwrap();
        create_series(dir.path(), &sample_input("A")).unwrap();
        create_series(dir.path(), &sample_input("B")).unwrap();
        delete_series(dir.path(), "1").unwrap();
        let list = list_series(dir.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "2");
    }

    #[test]
    fn delete_not_found() {
        let dir = tempdir().unwrap();
        let err = delete_series(dir.path(), "999").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn notes_empty_not_persisted() {
        // 系列名 + 空 notes → 写盘后 file 里没 notes 字段
        let dir = tempdir().unwrap();
        let s = create_series(dir.path(), &sample_input("A")).unwrap();
        let raw = std::fs::read_to_string(series_file(dir.path().to_str().unwrap())).unwrap();
        assert!(raw.contains("\"name\""), "name 必须写");
        assert!(!raw.contains("\"notes\""), "空 notes 不应写盘");
        let _ = s;
    }

    #[test]
    fn notes_non_empty_persisted() {
        let dir = tempdir().unwrap();
        let mut input = sample_input("A");
        input.notes = "简介".to_string();
        create_series(dir.path(), &input).unwrap();
        let raw = std::fs::read_to_string(series_file(dir.path().to_str().unwrap())).unwrap();
        assert!(raw.contains("\"notes\""));
    }

    #[test]
    fn invalid_series_dropped_on_read() {
        // 模拟磁盘上有"坏 series"：id 或 name 缺一
        let dir = tempdir().unwrap();
        std::fs::write(
            series_file(dir.path().to_str().unwrap()),
            r#"{
                "version": 1,
                "series": [
                    { "id": "1", "name": "好的", "created": "", "updated": "" },
                    { "id": "", "name": "缺 id", "created": "", "updated": "" },
                    { "id": "3", "name": "", "created": "", "updated": "" }
                ]
            }"#,
        )
        .unwrap();
        let list = list_series(dir.path()).unwrap();
        assert_eq!(list.len(), 1, "缺 id / 空 name 的 series 应被过滤");
        assert_eq!(list[0].id, "1");
    }

    #[test]
    fn version_zero_normalizes_to_one() {
        let dir = tempdir().unwrap();
        std::fs::write(
            series_file(dir.path().to_str().unwrap()),
            r#"{"version": 0, "series": []}"#,
        )
        .unwrap();
        let f = read_series_file(dir.path()).unwrap();
        assert_eq!(f.version, 1);
    }

    #[test]
    fn missing_series_array_uses_empty() {
        let dir = tempdir().unwrap();
        std::fs::write(
            series_file(dir.path().to_str().unwrap()),
            r#"{"version": 1}"#,
        )
        .unwrap();
        let f = read_series_file(dir.path()).unwrap();
        assert!(f.series.is_empty());
    }
}