//! data_dir 服务 —— 双仓分离(应用层 / 数据层)+ 全局 cache + 初始化。
//!
//! 与 `src/main/service/data-dir.ts` 1:1 对应。
//!
//! 双仓:
//! - 应用层:`%APPDATA%/book-tracker/config.json`,只存 `data_dir`
//! - 数据层:`<data_dir>/config.json`,完整 `Config`

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::data::config as cfg_data;
use crate::data::files::{ensure_dir, read_json, write_json};
use crate::types::Config;

const CONFIG_FILENAME: &str = "config.json";

/// 全局 cache 的 data_dir。`Mutex<Option<String>>` 保证线程安全(Tauri 命令多线程)。
static CACHED_DATA_DIR: Mutex<Option<String>> = Mutex::new(None);

/// 应用层 config 结构。
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

/// 计算应用层 config 路径。`%APPDATA%/book-tracker/config.json`。
///
/// Tauri 2 提供 `app.path().app_config_dir()`,但在 service 层不便直接拿到 AppHandle。
/// 这里用环境变量回退到本地约定(`XDG_CONFIG_HOME` / `APPDATA`)。
pub fn app_config_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("book-tracker");
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg).join("book-tracker");
    }
    // macOS: ~/Library/Application Support/book-tracker
    if cfg!(target_os = "macos") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("book-tracker");
        }
    }
    // Linux fallback
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".config").join("book-tracker");
    }
    PathBuf::from(".")
}

fn read_app_config() -> AppConfig {
    let p = app_config_dir().join(CONFIG_FILENAME);
    read_json(&p, AppConfig { version: 1, data_dir: String::new() }).unwrap_or_else(|_| AppConfig {
        version: 1,
        data_dir: String::new(),
    })
}

fn write_app_config(cfg: &AppConfig) -> std::io::Result<()> {
    let dir = app_config_dir();
    ensure_dir(&dir)?;
    write_json(dir.join(CONFIG_FILENAME), cfg)
}

/// 检查路径是否存在。
fn dir_exists(p: &str) -> bool {
    Path::new(p).is_dir()
}

/// 应用启动时初始化:返回 data_dir(自动 picker if missing)。
///
/// 在 Tauri 命令中,`picker` 闭包由调用方传入(用 tauri-plugin-dialog)。
pub fn init_with_picker<F>(picker: F) -> Result<String, String>
where
    F: FnOnce() -> Option<String>,
{
    if let Ok(guard) = CACHED_DATA_DIR.lock() {
        if let Some(d) = guard.as_ref() {
            return Ok(d.clone());
        }
    }
    let app_cfg = read_app_config();
    let chosen = if !app_cfg.data_dir.is_empty() && dir_exists(&app_cfg.data_dir) {
        app_cfg.data_dir
    } else {
        match picker() {
            Some(picked) => picked,
            None => return Err("user cancelled data dir picker".to_string()),
        }
    };

    // 写应用层 config
    write_app_config(&AppConfig {
        version: 1,
        data_dir: chosen.clone(),
    })
    .map_err(|e| format!("write app config: {e}"))?;

    // 同步初始化 data_dir 自带结构(见 AGENTS.md § 十四 #11)
    write_default_data_dir_config(&chosen).map_err(|e| format!("init data dir config: {e}"))?;
    let books_dir = crate::data::config::paths::books_dir(&chosen);
    ensure_dir(&books_dir).map_err(|e| format!("ensure books dir: {e}"))?;

    if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
        *guard = Some(chosen.clone());
    }
    Ok(chosen)
}

/// 写默认 data_dir config(首次 picker 后调用)。
fn write_default_data_dir_config(data_dir: &str) -> std::io::Result<()> {
    cfg_data::write_config(&Config {
        version: 1,
        data_dir: data_dir.to_string(),
        language: "zh-CN".to_string(),
        default_mode: crate::types::DefaultMode::Clean,
    })
}

/// 取当前 data_dir(必须先 init_with_picker)。
pub fn get_cached() -> Result<String, String> {
    CACHED_DATA_DIR
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "data dir not initialized".to_string())
}

/// 重置 cache(切换数据目录时用)。
pub fn reset() {
    if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
        *guard = None;
    }
}

/// 直接设置 cache(命令里初始化后调用)。
pub fn set_cached(dir: String) {
    if let Ok(mut guard) = CACHED_DATA_DIR.lock() {
        *guard = Some(dir);
    }
}

/// 读取应用层 config(给命令用)。
pub fn read_app_config_for_cmd() -> AppConfig {
    read_app_config()
}
