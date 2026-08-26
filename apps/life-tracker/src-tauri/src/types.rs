//! 跨进程共享类型定义 —— Rust 端镜像(serde)。
//!
//! 通用类型（Edge / Progress / RelationsFile / UnlockResult / UnlockRule）已抽到
//! `crates/tracker-core`（monorepo 共享内核），本文件只保留 Goal 领域类型，
//! 并 re-export core 的通用类型（保持 `crate::types::Edge` 等引用不变）。
//!
//! 与 `src/shared/types.ts` 1:1 对应。

use serde::{Deserialize, Serialize};

// 通用类型：来自共享内核（crates/tracker-core）
// `ExcludeSpec` 在共享内核里是 `PrereqSpec::Exclude { trigger, target, effect }` 的
// 形态；用类型别名保持 IPC / UI 侧的语义命名。
pub use tracker_core::{
    Edge, ExcludeEffect, PrereqSpec, Progress, RelationsFile, UnlockResult, UnlockRule,
};
/// 互斥规则别名（v2），与 `PrereqSpec::Exclude { trigger, target, effect }` 等价。
pub type ExcludeSpec = PrereqSpec;

/// 目标推进状态。`'not_started' | 'in_progress' | 'done' | 'shelved' | 'abandoned'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    NotStarted,
    InProgress,
    Done,
    Shelved,
    Abandoned,
}

impl GoalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            GoalStatus::NotStarted => "not_started",
            GoalStatus::InProgress => "in_progress",
            GoalStatus::Done => "done",
            GoalStatus::Shelved => "shelved",
            GoalStatus::Abandoned => "abandoned",
        }
    }
}

/// 一个目标的完整结构(后端 ↔ 前端通信载体)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub title: String,
    /// 描述 / 备注
    pub note: String,
    /// 分类，如"学业 / 科研 / 健康"
    pub category: String,
    /// 截止日期 `YYYY-MM-DD`；`None` = 无截止
    pub deadline: Option<String>,
    pub status: GoalStatus,
    /// 量化进度(如"2 篇 SCI 已完成 1 篇")；`None` = 无量化目标
    pub progress: Option<Progress>,
    /// 可计数任务：别的目标引用时可指定需要完成多少次。
    /// countable 任务在解锁语义上不存在"全达成"——它就是个计数器，
    /// 引用方 simple spec 携带的 `count` 直接对 progress.current 做比较。
    pub countable: bool,
    /// 置顶展示：in_progress 时显示在 CleanMode 顶部『进行中』栏
    pub pinned: bool,
    /// 日常模式收起：not_started / in_progress 时从『现在能推进的目标』列表隐藏（纯展示，不影响解锁）
    pub hidden: bool,
    /// ISO 8601 字符串
    pub created: String,
    /// ISO 8601 字符串
    pub updated: String,
}

/// 创建目标的用户输入。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalInput {
    pub title: String,
    pub note: String,
    pub category: String,
    pub deadline: Option<String>,
    pub status: GoalStatus,
    pub progress: Option<Progress>,
    /// 可计数（默认 false）
    #[serde(default)]
    pub countable: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
}

/// 更新目标的 patch(全字段可选)。
///
/// `progress` 用 `Option<Option<Progress>>` 区分三种语义:
/// - `None` → 不修改
/// - `Some(None)` → 显式清空(置 null)
/// - `Some(Some(p))` → 设置为 p
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct GoalPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<GoalStatus>,
    /// 三态:`None` = 不改 / `Some(None)` = 清空 / `Some(Some(p))` = 设值
    #[serde(default, deserialize_with = "double_option")]
    pub progress: Option<Option<Progress>>,
    /// 可计数
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub countable: Option<bool>,
    /// 置顶展示
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// 日常模式收起
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

/// 自定义反序列化:让 `Option<Option<T>>` 区分"字段不存在"和"字段为 null"。
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// 应用配置(数据目录自带)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    /// 用户数据根目录(绝对路径)
    pub data_dir: String,
    pub language: String,
    pub default_mode: DefaultMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Clean,
    Edit,
}
