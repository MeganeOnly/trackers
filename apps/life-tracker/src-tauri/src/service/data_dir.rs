//! data_dir 服务 —— 双仓分离(应用层 / 数据层)+ 全局 cache + 初始化。
//!
//! 通用流程（`%APPDATA%/<app>` 双仓、cache、picker 初始化）在 `tracker-core::data_dir`，
//! 本文件只做 Goal 领域适配：默认 Config 形状 + `goals/` 目录初始化。

use std::path::PathBuf;

use tracker_core::data_dir::DataDir;

/// life-tracker 的 DataDir 实例（app 名决定 `%APPDATA%/<app>`）。
fn dd() -> DataDir {
    DataDir::new("life-tracker")
}

/// 计算应用层 config 路径。`%APPDATA%/life-tracker/config.json`。
pub fn app_config_dir() -> PathBuf {
    dd().app_config_dir()
}

/// 应用启动时初始化:返回 data_dir(自动 picker if missing)。
///
/// 领域部分:写数据层默认 Config + 创建 `goals/` 目录(避免空壳)。
pub fn init_with_picker<F>(picker: F) -> Result<String, String>
where
    F: FnOnce() -> Option<String>,
{
    dd().init_with_picker(picker, |chosen| {
        crate::data::config::write_config(&crate::types::Config {
            version: 1,
            data_dir: chosen.to_string(),
            language: "zh-CN".to_string(),
            default_mode: crate::types::DefaultMode::Clean,
        })?;
        let goals_dir = crate::data::config::paths::goals_dir(chosen);
        tracker_core::files::ensure_dir(&goals_dir)?;
        Ok(())
    })
}

/// 取当前 data_dir(必须先 init_with_picker)。
pub fn get_cached() -> Result<String, String> {
    dd().get_cached()
}

/// 重置 cache(切换数据目录时用)。
pub fn reset() {
    dd().reset()
}

/// 直接设置 cache(命令里初始化后调用)。
pub fn set_cached(dir: String) {
    dd().set_cached(dir)
}

/// 读取应用层 config(给命令用)。
pub fn read_app_config_for_cmd() -> tracker_core::data_dir::AppConfig {
    dd().read_app_config_for_cmd()
}
