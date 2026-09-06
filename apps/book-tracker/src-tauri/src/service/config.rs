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
    let sidebar_series_entry_mode = patch.sidebar_series_entry_mode
        .map(|m| match m.as_str() {
            "inline-row" => m.to_string(),
            _ => "inline-row".to_string(),
        })
        .unwrap_or(current.sidebar_series_entry_mode);
    let new = Config {
        version: 1,
        data_dir: current.data_dir, // 不允许通过 patch 改 data_dir
        language: patch.language.unwrap_or(current.language),
        default_mode: patch.default_mode.unwrap_or(current.default_mode),
        default_work_kind: patch.default_work_kind.unwrap_or(current.default_work_kind),
        works_filter: patch.works_filter.unwrap_or(current.works_filter),
        theme,
        format,
        sidebar_series_entry_mode,
        use_local_fonts: patch.use_local_fonts.unwrap_or(current.use_local_fonts),
        use_cozy_tokens: patch.use_cozy_tokens.unwrap_or(current.use_cozy_tokens),
    };
    data::write_config(&new)?;
    Ok(new)
}

/// config patch 结构(只允许改 language / default_mode / default_work_kind / works_filter / theme / format / sidebar_series_entry_mode / use_local_fonts / use_cozy_tokens)。
///
/// 两个开关字段都是 `Option<bool>`:`None` = 不改;`Some(true/false)` = 写为该值。
/// 跟其他 patch 字段同款精神,默认值由 service 层决定。
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
    /// 侧栏系列入口展示模式；空 / 未知值 fallback inline-row(v2.x 起)
    pub sidebar_series_entry_mode: Option<String>,
    /// 「字体加载」开关；`None` 不改,`Some(true)` 用本地 ttf,`Some(false)` 走 Google Fonts CDN
    pub use_local_fonts: Option<bool>,
    /// 「柔化视觉」开关；`None` 不改,`Some(true)` 启用柔化 token,`Some(false)` 原值
    pub use_cozy_tokens: Option<bool>,
}
