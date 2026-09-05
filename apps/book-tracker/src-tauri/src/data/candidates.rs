//! `candidates.json` 读写 —— 候选剧集数据访问层。
//!
//! 与 `data/ranking.rs` / `data/series.rs` 同款顶层 JSON 文件模式：
//! 单文件存所有 candidates，原子写 + 容错读。
//!
//! 与 TS 端 `src/shared/types.ts: CandidatesFile` 1:1 对应。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::types::{Candidate, CandidatesFile};

const FILENAME: &str = "candidates.json";

/// `<data_dir>/candidates.json` 路径。
pub fn file(data_dir: impl AsRef<Path>) -> PathBuf {
    data_dir.as_ref().join(FILENAME)
}

/// 读 `<data_dir>/candidates.json`。文件不存在或损坏 → 返回空文件。
pub fn read_all(data_dir: impl AsRef<Path>) -> std::io::Result<CandidatesFile> {
    let path = file(data_dir);
    let raw = tracker_core::files::read_json::<serde_json::Value>(&path, serde_json::json!({}))?;
    Ok(normalize(raw))
}

/// 写 `<data_dir>/candidates.json`（原子）。
pub fn write_all(data_dir: impl AsRef<Path>, file_data: &CandidatesFile) -> std::io::Result<()> {
    let path = file(data_dir);
    tracker_core::files::write_json(&path, file_data)
}

/// 容错纠正为 CandidatesFile。
/// - version 缺失 → 1
/// - items 不是数组 → 空
/// - 单条 item 缺字段 → 跳过（serde 反序列化失败 = 该条作废）
fn normalize(raw: serde_json::Value) -> CandidatesFile {
    let obj = raw.as_object();
    let version = obj
        .and_then(|o| o.get("version"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .unwrap_or(1);
    let items_raw = obj
        .and_then(|o| o.get("items"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<Candidate> = items_raw
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    CandidatesFile { version, items }
}

/// 按 title 查一条候选（去重 / promote 查找用）。
pub fn find_by_title(data_dir: impl AsRef<Path>, title: &str) -> std::io::Result<Option<Candidate>> {
    let f = read_all(data_dir)?;
    Ok(f.items.into_iter().find(|c| c.title == title))
}

/// 按 id 查一条候选。
pub fn find_by_id(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Candidate>> {
    let f = read_all(data_dir)?;
    Ok(f.items.into_iter().find(|c| c.id == id))
}

/// 追加一条候选。同 id 原地替换；不查重（service 层先查）。
pub fn append(data_dir: impl AsRef<Path>, candidate: &Candidate) -> std::io::Result<CandidatesFile> {
    let mut f = read_all(&data_dir)?;
    let mut ids: HashSet<String> = f.items.iter().map(|c| c.id.clone()).collect();
    if ids.contains(&candidate.id) {
        for item in f.items.iter_mut() {
            if item.id == candidate.id {
                *item = candidate.clone();
                break;
            }
        }
    } else {
        ids.insert(candidate.id.clone());
        f.items.push(candidate.clone());
    }
    write_all(&data_dir, &f)?;
    Ok(f)
}

/// 按 id 删除一条候选。
pub fn remove_by_id(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<CandidatesFile> {
    let mut f = read_all(&data_dir)?;
    let before = f.items.len();
    f.items.retain(|c| c.id != id);
    if f.items.len() != before {
        write_all(&data_dir, &f)?;
    }
    Ok(f)
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn mk_candidate(id: &str, title: &str) -> Candidate {
        Candidate {
            id: id.to_string(),
            title: title.to_string(),
            tags: vec!["tag1".to_string()],
            note: None,
            added_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn read_missing_returns_default() {
        let dir = tempdir().unwrap();
        let got = read_all(dir.path()).unwrap();
        assert_eq!(got.version, 1);
        assert!(got.items.is_empty());
    }

    #[test]
    fn append_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let c = mk_candidate("c_1", "大宋提刑官");
        append(dir.path(), &c).unwrap();
        let got = read_all(dir.path()).unwrap();
        assert_eq!(got.items.len(), 1);
        assert_eq!(got.items[0].title, "大宋提刑官");
        assert_eq!(got.items[0].id, "c_1");
    }

    #[test]
    fn append_duplicate_id_replaces_in_place() {
        let dir = tempdir().unwrap();
        let mut c = mk_candidate("c_1", "大宋提刑官");
        append(dir.path(), &c).unwrap();
        c.note = Some("更新 note".to_string());
        append(dir.path(), &c).unwrap();
        let got = read_all(dir.path()).unwrap();
        assert_eq!(got.items.len(), 1);
        assert_eq!(got.items[0].note.as_deref(), Some("更新 note"));
    }

    #[test]
    fn remove_by_id_works() {
        let dir = tempdir().unwrap();
        append(dir.path(), &mk_candidate("c_1", "A")).unwrap();
        append(dir.path(), &mk_candidate("c_2", "B")).unwrap();
        let got = remove_by_id(dir.path(), "c_1").unwrap();
        assert_eq!(got.items.len(), 1);
        assert_eq!(got.items[0].id, "c_2");
    }

    #[test]
    fn remove_nonexistent_is_noop() {
        let dir = tempdir().unwrap();
        append(dir.path(), &mk_candidate("c_1", "A")).unwrap();
        let got = remove_by_id(dir.path(), "nope").unwrap();
        assert_eq!(got.items.len(), 1);
    }

    #[test]
    fn find_by_title_and_id() {
        let dir = tempdir().unwrap();
        append(dir.path(), &mk_candidate("c_1", "大宋提刑官")).unwrap();
        assert!(find_by_title(dir.path(), "大宋提刑官").unwrap().is_some());
        assert!(find_by_title(dir.path(), "少年包青天").unwrap().is_none());
        assert!(find_by_id(dir.path(), "c_1").unwrap().is_some());
        assert!(find_by_id(dir.path(), "c_nope").unwrap().is_none());
    }

    #[test]
    fn normalize_invalid_items_skips_bad_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(FILENAME);
        std::fs::write(
            &path,
            r#"{"version":1,"items":[{"id":"ok","title":"A","tags":[],"addedAt":"2026-01-01T00:00:00.000Z"},{"id":"bad"}]}"#,
        )
        .unwrap();
        let got = read_all(dir.path()).unwrap();
        assert_eq!(got.items.len(), 1);
        assert_eq!(got.items[0].id, "ok");
    }
}
