//! config.json 通用读写骨架（领域无关）。
//!
//! 两个 app 共用的约定：数据目录下 `config.json`。
//! 领域 Config 结构（如 book 的 `default_mode`）由各 app 自己定义并 normalize，
//! 本模块只提供"读成 Value / 原子写成 T"的骨架 + 双仓分离中"数据层 config"的路径约定。

use std::path::Path;

pub const CONFIG_FILENAME: &str = "config.json";

/// 读 `<data_dir>/config.json` 为 Value；文件不存在 → 空对象。
pub fn read_config_value(data_dir: impl AsRef<Path>) -> std::io::Result<serde_json::Value> {
    let path = data_dir.as_ref().join(CONFIG_FILENAME);
    crate::files::read_json::<serde_json::Value>(&path, serde_json::json!({}))
}

/// 原子写 `<data_dir>/config.json`（自动 ensure dir）。
pub fn write_config_value<T: serde::Serialize>(
    data_dir: impl AsRef<Path>,
    config: &T,
) -> std::io::Result<()> {
    let dir = data_dir.as_ref();
    crate::files::ensure_dir(dir)?;
    crate::files::write_json(dir.join(CONFIG_FILENAME), config)
}

/// 数据目录布局约定。各 app 自定义自己的条目子目录（books/ / goals/），
/// `relations_file` / `config_file` 两者一致。
pub mod paths {
    use std::path::PathBuf;

    pub fn relations_file(data_dir: &str) -> PathBuf {
        PathBuf::from(data_dir).join("relations.json")
    }

    pub fn config_file(data_dir: &str) -> PathBuf {
        PathBuf::from(data_dir).join("config.json")
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_missing_returns_empty_object() {
        let dir = tempdir().unwrap();
        let v = read_config_value(dir.path()).unwrap();
        assert!(v.as_object().unwrap().is_empty());
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        #[derive(serde::Serialize)]
        struct TestConfig {
            version: u32,
            data_dir: String,
        }
        let cfg = TestConfig {
            version: 1,
            data_dir: dir.path().to_string_lossy().to_string(),
        };
        write_config_value(dir.path(), &cfg).unwrap();
        let v = read_config_value(dir.path()).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["data_dir"].as_str().unwrap(), dir.path().to_string_lossy());
    }

    #[test]
    fn paths_helpers() {
        assert!(paths::relations_file("/d").ends_with("relations.json"));
        assert!(paths::config_file("/d").ends_with("config.json"));
    }
}