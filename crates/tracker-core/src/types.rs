//! 跨进程共享类型 —— Rust 端（serde 镜像）。
//!
//! 与 `packages/tracker-core/src/types.ts` 1:1 对应，字段名 / 值完全一致。
//! 领域类型（Book / Goal / Config / 状态枚举）由各 app 自己定义，不进 core。

use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::Serializer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

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

/// 二选一 / N 选一组合成员（v3）：
/// - 字符串形态：`"B"` 等价于 `{ id: "B", count: 1 }`（向后兼容旧数据）
/// - 对象形态：`{ id: "B", count: 2 }` 支持 per-member count
///
/// 序列化：count === 1 时省略 count 字段（避免 relations.json 污染）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GroupMember {
    /// 仅 id，引用次数默认 1
    Id(String),
    /// 带引用次数的成员
    WithCount { id: String, count: u32 },
}

impl GroupMember {
    pub fn id(&self) -> &str {
        match self {
            GroupMember::Id(s) => s,
            GroupMember::WithCount { id, .. } => id,
        }
    }
    /// 取引用次数（默认 1）。1 视作缺省值。
    pub fn count(&self) -> u32 {
        match self {
            GroupMember::Id(_) => 1,
            GroupMember::WithCount { count, .. } => (*count).max(1),
        }
    }
}

impl Serialize for GroupMember {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // 形态选择：count == 1 → 序列化为字符串；否则序列化为 `{id, count}`
        match self {
            GroupMember::Id(s) => serializer.serialize_str(s),
            GroupMember::WithCount { id, count } if *count <= 1 => {
                serializer.serialize_str(id)
            }
            GroupMember::WithCount { id, count } => {
                use serde::ser::SerializeStruct;
                let mut st = serializer.serialize_struct("GroupMember", 2)?;
                st.serialize_field("id", id)?;
                st.serialize_field("count", count)?;
                st.end()
            }
        }
    }
}

struct GroupMemberVisitor;

impl<'de> Visitor<'de> for GroupMemberVisitor {
    type Value = GroupMember;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("string id or { id, count? } object")
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(GroupMember::Id(v.to_string()))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
        Ok(GroupMember::Id(v))
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut id: Option<String> = None;
        let mut count: Option<u32> = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "id" => id = Some(map.next_value()?),
                "count" => count = Some(map.next_value()?),
                _ => {
                    let _: serde::de::IgnoredAny = map.next_value()?;
                }
            }
        }
        let id = id.ok_or_else(|| de::Error::missing_field("id"))?;
        match count {
            None | Some(1) => Ok(GroupMember::Id(id)),
            Some(c) => Ok(GroupMember::WithCount { id, count: c }),
        }
    }
}

impl<'de> Deserialize<'de> for GroupMember {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(GroupMemberVisitor)
    }
}

/// 简单前置：单个目标引用
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PrereqSpec {
    /// 简单前置：单个目标引用。
    /// `count` 是引用次数：缺省 / 1 时等价于"目标已完成即可"；
    /// >= 2 时要求目标是 countable 任务且 progress.current >= count。
    /// 写盘时 `count == 1` 跳过序列化，避免污染 relations.json。
    Simple {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<u32>,
    },
    /// 二选一 / N 选一组合：`pick` 默认为 1（任选其一）。
    /// `members` 支持字符串（向后兼容）或 `{id, count}` 形态。
    #[serde(rename_all = "snake_case")]
    Group {
        members: Vec<GroupMember>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pick: Option<u32>,
    },
    /// 计数任务：成员里至少 `need` 个 done（v3 暂未扩展 per-member count）
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
