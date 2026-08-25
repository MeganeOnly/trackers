//! 跨进程共享类型 —— Rust 端（serde 镜像）。
//!
//! 与 `packages/tracker-core/src/types.ts` 1:1 对应，字段名 / 值完全一致。
//! 领域类型（Book / Goal / Config / 状态枚举）由各 app 自己定义，不进 core。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 进度。`{ current: u32, total: u32 | null }`
/// `total = null` 表示总量未知（连载 / 开放式目标）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    /// 当前进度（≥0）
    pub current: u32,
    /// 总量；`null` = 未知
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
}

/// 解锁规则。`'all' | 'any_of'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnlockRule {
    All,
    AnyOf,
}

/// 一条前置边：目标条目 `to` 需要 `prerequisites` 中若干已完成
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub to: String,
    pub prerequisites: Vec<String>,
    pub rule: UnlockRule,
    /// 仅 `rule == AnyOf` 时使用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<u32>,
    /// 二选一/N选一组合（AND-of-ORs）：每个内层数组是一组「互斥选一」成员，
    /// 组之间以及「不在任何组里的前置」均为必须 done。
    /// 缺省 / 空数组时回退到 `rule` + `threshold` 的整组逻辑（向后兼容）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<Vec<String>>>,
}

/// `relations.json` 文件结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationsFile {
    pub version: u32,
    pub edges: Vec<Edge>,
}

/// `compute_unlocked` 的返回结构
#[derive(Debug, Clone)]
pub struct UnlockResult {
    /// `id → 是否解锁`
    pub unlocked: HashMap<String, bool>,
    /// 循环依赖涉及到的节点列表（每个环一组）
    pub cycles: Vec<Vec<String>>,
}
