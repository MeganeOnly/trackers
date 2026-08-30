//! `rankings.json` 读写 —— 两两对比排名历史。
//!
//! 文件位置：`<data_dir>/rankings.json`。
//! 只持久化 `history` + 算法参数（initial_rating / k_factor）；评分由前端实时从 history 重算。
//!
//! 文件缺失 → 返回 `RankingFile::default()`（version=1、空 history）。
//! 算法参数缺省时也走 default —— 旧文件不会因为新增字段而失败。

use std::path::Path;

use tracker_core::files::{atomic_write_file, read_json};
use tracker_core::RankingFile;

/// 读 `<data_dir>/rankings.json`。文件不存在 → 返回默认空 RankingFile。
pub fn read_ranking(data_dir: impl AsRef<Path>) -> std::io::Result<RankingFile> {
    let path = data_dir.as_ref().join("rankings.json");
    let raw: RankingFile = read_json(&path, RankingFile::default())?;
    // 容错：version 缺失 / 0 → 视为 1；initial_rating / k_factor 已由 serde default 处理
    let file = RankingFile {
        version: if raw.version == 0 { 1 } else { raw.version },
        ..raw
    };
    Ok(file)
}

/// 原子写 `<data_dir>/rankings.json`。
pub fn write_ranking(data_dir: impl AsRef<Path>, file: &RankingFile) -> std::io::Result<()> {
    let path = data_dir.as_ref().join("rankings.json");
    let s = serde_json::to_string_pretty(file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    atomic_write_file(&path, &(s + "\n"))
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tracker_core::{PairwiseResult, PairwiseWinner};

    #[test]
    fn missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let f = read_ranking(dir.path()).unwrap();
        assert_eq!(f.version, 1);
        assert_eq!(f.initial_rating, 1500.0);
        assert_eq!(f.k_factor, 32.0);
        assert!(f.history.is_empty());
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let file = RankingFile {
            version: 1,
            initial_rating: 1500.0,
            k_factor: 32.0,
            history: vec![
                PairwiseResult {
                    a: "1".into(),
                    b: "2".into(),
                    winner: PairwiseWinner::A,
                    ts: "2025-01-15T10:00:00Z".into(),
                },
                PairwiseResult {
                    a: "2".into(),
                    b: "3".into(),
                    winner: PairwiseWinner::Tie,
                    ts: "2025-01-15T10:05:00Z".into(),
                },
            ],
        };
        write_ranking(dir.path(), &file).unwrap();
        let got = read_ranking(dir.path()).unwrap();
        assert_eq!(got.version, 1);
        assert_eq!(got.initial_rating, 1500.0);
        assert_eq!(got.k_factor, 32.0);
        assert_eq!(got.history.len(), 2);
        assert_eq!(got.history[0].a, "1");
        assert_eq!(got.history[0].b, "2");
        assert!(matches!(got.history[0].winner, PairwiseWinner::A));
        assert!(matches!(got.history[1].winner, PairwiseWinner::Tie));
    }

    #[test]
    fn version_zero_normalizes_to_one() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("rankings.json"),
            r#"{"version":0,"history":[]}"#,
        )
        .unwrap();
        let f = read_ranking(dir.path()).unwrap();
        assert_eq!(f.version, 1);
    }

    #[test]
    fn serializes_algorithm_params_as_camel_case() {
        // 前端 RankingFile 用 initialRating / kFactor；IPC JSON 键名必须对齐，
        // 否则前端读到 undefined，排名列表渲染 `score.toFixed()` 会崩成白屏。
        let dir = tempdir().unwrap();
        write_ranking(dir.path(), &RankingFile::default()).unwrap();
        let s = std::fs::read_to_string(dir.path().join("rankings.json")).unwrap();
        assert!(s.contains("\"initialRating\""), "got: {s}");
        assert!(s.contains("\"kFactor\""), "got: {s}");
        assert!(!s.contains("\"initial_rating\""), "got: {s}");
        assert!(!s.contains("\"k_factor\""), "got: {s}");
    }

    #[test]
    fn legacy_snake_case_params_still_parse() {
        // 兼容旧版本写下的 rankings.json（snake_case 键名）
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("rankings.json"),
            r#"{"version":1,"initial_rating":1200.0,"k_factor":24.0,"history":[]}"#,
        )
        .unwrap();
        let f = read_ranking(dir.path()).unwrap();
        assert_eq!(f.initial_rating, 1200.0);
        assert_eq!(f.k_factor, 24.0);
    }

    #[test]
    fn missing_algorithm_params_use_defaults() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("rankings.json"),
            r#"{"version":1,"history":[]}"#,
        )
        .unwrap();
        let f = read_ranking(dir.path()).unwrap();
        assert_eq!(f.initial_rating, 1500.0);
        assert_eq!(f.k_factor, 32.0);
    }
}
