//! config.json 读写(数据目录自带那份)—— Book 领域 Config。
//!
//! 双仓分离:
//! - `%APPDATA%/book-tracker/config.json` —— 只存 `data_dir`(应用启动入口)
//! - `<data_dir>/config.json` —— 完整 `Config`(本文件负责)
//!
//! 通用读写骨架(read/write config value、relations/config 路径)在 `tracker-core::config`。

use std::path::{Path, PathBuf};

use crate::types::{Config, DefaultMode, WorkKind};

/// 默认 Config。`data_dir` 为空字符串表示未设置。
pub fn default_config() -> Config {
    Config {
        version: 1,
        data_dir: String::new(),
        language: "zh-CN".to_string(),
        default_mode: DefaultMode::Clean,
        default_work_kind: WorkKind::Book,
        works_filter: "all".to_string(),
    }
}

/// 读 `<data_dir>/config.json`。文件不存在或字段缺失 → 用默认值 + 容错纠正。
pub fn read_config(data_dir: impl AsRef<Path>) -> std::io::Result<Config> {
    let raw = tracker_core::config::read_config_value(data_dir)?;
    Ok(normalize(raw))
}

/// 写 `<data_dir>/config.json`(原子)。
pub fn write_config(config: &Config) -> std::io::Result<()> {
    tracker_core::config::write_config_value(&config.data_dir, config)
}

/// 从 raw JSON 容错纠正为 Config。
/// - 缺字段用默认
/// - `language` 不在合法集合内 → fallback "zh-CN"
/// - `default_mode` 不在合法集合内 → fallback "clean"
fn normalize(raw: serde_json::Value) -> Config {
    let obj = raw.as_object();
    let get_str = |k: &str| obj.and_then(|o| o.get(k)).and_then(|v| v.as_str()).map(String::from);
    let get_num = |k: &str| obj.and_then(|o| o.get(k)).and_then(|v| v.as_u64());

    Config {
        version: get_num("version").map(|n| n as u32).unwrap_or(1),
        data_dir: get_str("data_dir").unwrap_or_default(),
        language: {
            let lang = get_str("language").unwrap_or_else(|| "zh-CN".to_string());
            if lang == "zh-CN" { "zh-CN".to_string() } else { "zh-CN".to_string() }
        },
        default_mode: {
            let m = obj
                .and_then(|o| o.get("default_mode"))
                .and_then(|v| v.as_str())
                .unwrap_or("clean");
            if m == "edit" { DefaultMode::Edit } else { DefaultMode::Clean }
        },
        default_work_kind: WorkKind::parse(
            obj.and_then(|o| o.get("default_work_kind")).and_then(|v| v.as_str()),
        ),
        works_filter: {
            let f = get_str("works_filter").unwrap_or_default();
            if f.is_empty() { "all".to_string() } else { f }
        },
    }
}

/// 数据目录布局约定。`relations_file` / `config_file` 直接复用 tracker-core 的版本，
/// 不在本目录二次包装（保持单点定义）。
pub mod paths {
    use super::PathBuf;

    pub fn books_dir(data_dir: &str) -> PathBuf {
        PathBuf::from(data_dir).join("books")
    }
    pub use tracker_core::config::paths::{config_file, relations_file};
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let cfg = Config {
            version: 1,
            data_dir: dir.path().to_string_lossy().to_string(),
            language: "zh-CN".to_string(),
            default_mode: DefaultMode::Edit,
            default_work_kind: WorkKind::Anime,
            works_filter: "movie".to_string(),
        };
        write_config(&cfg).unwrap();
        let got = read_config(&cfg.data_dir).unwrap();
        assert_eq!(got.data_dir, cfg.data_dir);
        assert_eq!(got.language, cfg.language);
        assert_eq!(got.default_mode, DefaultMode::Edit);
        assert_eq!(got.default_work_kind, WorkKind::Anime);
        assert_eq!(got.works_filter, "movie");
    }

    #[test]
    fn read_missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let got = read_config(dir.path().to_string_lossy().as_ref()).unwrap();
        assert_eq!(got.version, 1);
        assert_eq!(got.data_dir, "");
        assert_eq!(got.language, "zh-CN");
        assert_eq!(got.default_mode, DefaultMode::Clean);
        assert_eq!(got.default_work_kind, WorkKind::Book);
        assert_eq!(got.works_filter, "all");
    }

    #[test]
    fn invalid_default_mode_falls_back_to_clean() {
        let dir = tempdir().unwrap();
        fs_json(dir.path().join("config.json"), r#"{"default_mode": "invalid_mode"}"#);
        let got = read_config(dir.path().to_string_lossy().as_ref()).unwrap();
        assert_eq!(got.default_mode, DefaultMode::Clean);
    }

    #[test]
    fn missing_fields_use_defaults() {
        let dir = tempdir().unwrap();
        fs_json(dir.path().join("config.json"), r#"{}"#);
        let got = read_config(dir.path().to_string_lossy().as_ref()).unwrap();
        assert_eq!(got.version, 1);
        assert_eq!(got.data_dir, "");
        assert_eq!(got.language, "zh-CN");
        assert_eq!(got.default_mode, DefaultMode::Clean);
    }

    #[test]
    fn paths_helpers() {
        assert!(paths::books_dir("/d").ends_with("books"));
        // relations_file / config_file 是 tracker-core 的 re-export；端到端
        // 形状由 tracker-core 自带的单测覆盖，这里只验证引入路径能调通。
        assert!(paths::relations_file("/d").ends_with("relations.json"));
        assert!(paths::config_file("/d").ends_with("config.json"));
    }

    fn fs_json(p: PathBuf, content: &str) {
        std::fs::write(p, content).unwrap();
    }
}
