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
    // theme / format 合并时按白名单过滤,跟 normalize 一致
    let theme = patch.theme
        .map(|t| match t.as_str() {
            "classic" | "library" | "codex" => t.to_string(),
            _ => "classic".to_string(),
        })
        .unwrap_or(current.theme);
    let format = patch.format
        .map(|f| match f.as_str() {
            "list" | "grid" | "focus-stack" => f.to_string(),
            _ => "list".to_string(),
        })
        .unwrap_or(current.format);
    let new = Config {
        version: 1,
        data_dir: current.data_dir, // 不允许通过 patch 改 data_dir
        language: patch.language.unwrap_or(current.language),
        default_mode: patch.default_mode.unwrap_or(current.default_mode),
        default_work_kind: patch.default_work_kind.unwrap_or(current.default_work_kind),
        works_filter: patch.works_filter.unwrap_or(current.works_filter),
        theme,
        format,
    };
    data::write_config(&new)?;
    Ok(new)
}

/// config patch 结构(只允许改 language / default_mode / default_work_kind / works_filter / theme / format)。
#[derive(Debug, Default, serde::Deserialize)]
pub struct ConfigPatch {
    pub language: Option<String>,
    pub default_mode: Option<DefaultMode>,
    pub default_work_kind: Option<WorkKind>,
    pub works_filter: Option<String>,
    /// 视觉主题预设；空 / 未知值 fallback classic
    pub theme: Option<String>,
    /// 信息呈现格式；空 / 未知值 fallback list
    pub format: Option<String>,
}
