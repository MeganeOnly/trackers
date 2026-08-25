//! config 业务逻辑 —— 包装 data/config。

use crate::data::config as data;
use crate::types::{Config, DefaultMode, WorkKind};

/// 读 config(完整版本,数据目录自带)。
pub fn get_config(data_dir: &str) -> std::io::Result<Config> {
    data::read_config(data_dir)
}

/// 写 config(patch 合并)。
pub fn set_config(data_dir: &str, patch: ConfigPatch) -> std::io::Result<Config> {
    let current = data::read_config(data_dir)?;
    let new = Config {
        version: 1,
        data_dir: current.data_dir, // 不允许通过 patch 改 data_dir
        language: patch.language.unwrap_or(current.language),
        default_mode: patch.default_mode.unwrap_or(current.default_mode),
        default_work_kind: patch.default_work_kind.unwrap_or(current.default_work_kind),
        works_filter: patch.works_filter.unwrap_or(current.works_filter),
    };
    data::write_config(&new)?;
    Ok(new)
}

/// config patch 结构(只允许改 language / default_mode / default_work_kind / works_filter)。
#[derive(Debug, Default, serde::Deserialize)]
pub struct ConfigPatch {
    pub language: Option<String>,
    pub default_mode: Option<DefaultMode>,
    pub default_work_kind: Option<WorkKind>,
    pub works_filter: Option<String>,
}
