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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnlockRule {
    #[default]
    All,
    AnyOf,
}

/// 前置规格类型（v2）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrereqKind {
    Simple,
    Group,
    Count,
    Exclude,
}

/// 简单前置：单个目标引用
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PrereqSpec {
    Simple { id: String },
    /// 二选一 / N 选一组合：`pick` 默认为 1（任选其一）
    #[serde(rename_all = "snake_case")]
    Group { members: Vec<String>, #[serde(default, skip_serializing_if = "Option::is_none")] pick: Option<u32> },
    /// 计数任务：成员里至少 `need` 个 done
    #[serde(rename_all = "snake_case")]
    Count { members: Vec<String>, need: u32 },
    /// 互斥规则：trigger 达成时改写 target 的 done 语义
    #[serde(rename_all = "snake_case")]
    Exclude { trigger: String, target: String, effect: ExcludeEffect },
}

/// `exclude.effect`：`disqualifies`（失格）/ `satisfies`（豁免）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExcludeEffect {
    Disqualifies,
    Satisfies,
}

impl ExcludeEffect {
    /// 对 done 集合的影响（应用层调用 compute_unlocked 前先改写）
    pub fn rewrite(self, raw_done: &mut HashMap<String, bool>, trigger: &str, target: &str) {
        if !matches!(raw_done.get(trigger).copied(), Some(true)) {
            return;
        }
        match self {
            ExcludeEffect::Disqualifies => {
                raw_done.insert(target.to_string(), false);
            }
            ExcludeEffect::Satisfies => {
                raw_done.insert(target.to_string(), true);
            }
        }
    }
}

/// 一条前置边：目标条目 `to` 需要 `prerequisites` 中若干已完成
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    /// v2：完整规格清单。AND-of-specs；`exclude` 项不算正向 spec。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub specs: Option<Vec<PrereqSpec>>,
    /// v2：独立互斥规则索引
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excludes: Option<Vec<PrereqSpec>>,
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
