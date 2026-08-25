//! data_dir 服务 —— 双仓分离（应用层 / 数据层）+ 全局 cache + 初始化。
//!
//! 从 book-tracker 抽取，app 名参数化，两个 app 共用：
//! - book-tracker: `DataDir::new("book-tracker")`
//! - life-tracker: `DataDir::new("life-tracker")`
//!
//! 双仓：
//! - 应用层：`%APPDATA%/<app>/config.json`，只存 `data_dir`（应用启动入口）
//! - 数据层：`<data_dir>/config.json`，完整领域 Config（由各 app 在 `init_with_picker`
//!   的 `write_default_config` 闭包里写，形状不同）

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::files::{ensure_dir, read_json, write_json};

const CONFIG_FILENAME: &str = "config.json";

/// 应用层 config 结构（只存 data_dir）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub data_dir: String,
}

fn default_version() -> u32 {
    1
}

/// 全局 cache：app_name → data_dir（Tauri 命令多线程共享）。
static CACHED_DATA_DIR: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 数据目录管理器（app 名参数化）。
pub struct DataDir {
    app_name: &'static str,
}

impl DataDir {
    pub fn new(app_name: &'static str) -> Self {
        Self { app_name }
    }

    /// 计算应用层 config 路径：`%APPDATA%/<app_name>/config.json`。
    pub fn app_config_dir(&self) -> PathBuf {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join(self.app_name);
        }
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            return PathBuf::from(xdg).join(self.app_name);
        }
        // macOS: ~/Library/Application Support/<app_name>
        if cfg!(target_os = "macos") {
            if let Some(home) = std::env::var_os("HOME") {
                return PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join(self.app_name);
            }
        }
        // Linux fallback
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(".config").join(self.app_name);
        }
        PathBuf::from(".")
    }

    fn read_app_config(&self) -> AppConfig {
        let p = self.app_config_dir().join(CONFIG_FILENAME);
        read_json(&p, AppConfig { version: 1, data_dir: String::new() })
            .unwrap_or_else(|_| AppConfig { version: 1, data_dir: String::new() })
    }

    fn write_app_config(&self, cfg: &AppConfig) -> std::io::Result<()> {
        let dir = self.app_config_dir();
        ensure_dir(&dir)?;
        write_json(dir.join(CONFIG_FILENAME), cfg)
    }

    /// 应用启动时初始化：返回 data_dir（必要时弹 picker）。
    ///
    /// `write_default_config`：写数据层默认 config + 创建条目目录（领域部分，由 app 提供）。
    pub fn init_with_picker<F>(
        &self,
        picker: F,
        write_default_config: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<String, String>
    where
        F: FnOnce() -> Option<String>,
    {
        if let Ok(guard) = CACHED_DATA_DIR.lock() {
            if let Some(d) = guard.get(self.app_name) {
                return Ok(d.clone());
            }
        }
        let app_cfg = self.read_app_config();
        let chosen = if !app_cfg.data_dir.is_empty() && Path::new(&app_cfg.data_dir).is_dir() {
            app_cfg.data_dir
        } else {
            match picker() {
                Some(picked) => picked,
                None => return Err("user cancelled data dir picker".to_string()),
            }
        };

        // 写应用层 config
        self.write_app_config(&AppConfig {
            version: 1,
            data_dir: chosen.clone(),
        })
        .map_err(|e| format!("write app config: {e}"))?;

        // 同步初始化数据层结构（领域 config + 条目目录）
        write_default_config(&chosen).map_err(|e| format!("init data dir config: {e}"))?;

        if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
            guard.insert(self.app_name.to_string(), chosen.clone());
        }
        Ok(chosen)
    }

    /// 取当前 data_dir（必须先 init_with_picker）。
    pub fn get_cached(&self) -> Result<String, String> {
        CACHED_DATA_DIR
            .lock()
            .map_err(|_| "lock poisoned".to_string())?
            .get(self.app_name)
            .cloned()
            .ok_or_else(|| "data dir not initialized".to_string())
    }

    /// 重置 cache（切换数据目录时用）。
    pub fn reset(&self) {
        if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
            guard.remove(self.app_name);
        }
    }

    /// 直接设置 cache（命令里初始化后调用）。
    pub fn set_cached(&self, dir: String) {
        if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
            guard.insert(self.app_name.to_string(), dir);
        }
    }

    /// 读取应用层 config（给命令用）。
    pub fn read_app_config_for_cmd(&self) -> AppConfig {
        self.read_app_config()
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_is_isolated_per_app() {
        let a = DataDir::new("test-app-a");
        assert!(a.get_cached().is_err());
        a.set_cached("/tmp/a".to_string());
        assert_eq!(a.get_cached().unwrap(), "/tmp/a");

        let b = DataDir::new("test-app-b");
        assert!(b.get_cached().is_err(), "不同 app 的 cache 应隔离");
        b.set_cached("/tmp/b".to_string());
        assert_eq!(b.get_cached().unwrap(), "/tmp/b");

        // reset 只清自己的
        a.reset();
        assert!(a.get_cached().is_err());
        assert_eq!(b.get_cached().unwrap(), "/tmp/b");
    }

    #[test]
    fn app_config_dir_uses_app_name() {
        let dd = DataDir::new("life-tracker");
        let p = dd.app_config_dir();
        assert!(p.to_string_lossy().contains("life-tracker"));
    }
}