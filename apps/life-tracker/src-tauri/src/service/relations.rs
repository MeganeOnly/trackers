//! relations 业务逻辑 —— 包装 tracker-core 的 relations,加 cycle validate。
//!
//! relations.json 的读写与边容错在共享内核 `tracker-core::relations`，
//! 本文件只加 Goal 侧的 cycle 校验文案与 unlock 适配。
//!
//! v2 exclude 改写：在调用 `compute_unlocked` 前用 `collect_excludes` 收集所有
//! `ExcludeSpec`，先把 done map 改写一遍（disqualifies → false；satisfies → true），
//! 再传入 compute_unlocked。与 TS 端 `apps/life-tracker/src/shared/done.ts` 的
//! `buildDonePredicate` 语义一致。
//!
//! countable 任务：done 谓词按引用方要求的次数判断 —— 自身 progress.current >= required_count
//! 就算 done（countable 任务在解锁语义上没有"全达成"，它就是个计数器）。

use std::collections::HashMap;
use std::path::Path;

use crate::types::{Edge, Goal, GoalStatus, PrereqSpec, UnlockResult};
use tracker_core::relations as data;
use tracker_core::unlock::{collect_excludes, compute_unlocked, detect_cycles};
use tracker_core::ExcludeEffect;

/// 读 relations → 返回 edges(空数组兜底)。
pub fn get_relations(data_dir: impl AsRef<Path>) -> std::io::Result<Vec<Edge>> {
    let file = data::read_relations(data_dir)?;
    Ok(file.edges)
}

/// 写 relations(带 cycle 检测)。
pub fn set_relations(data_dir: impl AsRef<Path>, edges: Vec<Edge>) -> std::io::Result<()> {
    data::write_relations(data_dir, &edges, Some(&|edges| {
        let cycles = detect_cycles(edges);
        if cycles.is_empty() {
            None
        } else {
            Some(format!(
                "检测到 {} 个循环依赖: {}",
                cycles.len(),
                cycles
                    .iter()
                    .take(3)
                    .map(|c| format!("[{}]", c.join(" → ")))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
    }))
}

/// 给定 goals + edges,算 unlock map + cycles。
///
/// 达成判定(与 TS `isGoalDone` 一致):status == Done,或量化进度已满(current >= total)。
/// countable 任务的 done 谓词按引用方要求的次数判断（progress.current >= required_count）。
/// v2: 应用所有 ExcludeSpec 改写 done map 后再算 unlock。
pub fn compute_unlocked_for(goals: &[Goal], edges: &[Edge]) -> UnlockResult {
    let ids: Vec<String> = goals.iter().map(|g| g.id.clone()).collect();

    // raw_done = 普通任务的"已达成"语义（status==done 或 progress 满）。
    // countable 任务的 raw_done 不参与谓词——其 done 由 progress.current >= required_count
    // 决定，所以这里把 countable 任务的 raw_done 留 false。
    let raw_done: HashMap<String, bool> = goals
        .iter()
        .map(|g| {
            let complete = !g.countable
                && (matches!(g.status, GoalStatus::Done)
                    || g.progress
                        .as_ref()
                        .is_some_and(|p| p.total.is_some_and(|t| p.current >= t)));
            (g.id.clone(), complete)
        })
        .collect();

    // excludes 强改写层：disqualifies → false；satisfies → true；trigger 未 done 不生效。
    // 与 TS 端 buildDonePredicate 语义一致 —— 改写后的结果视为 force_done。
    let excludes = collect_excludes(edges);
    let mut overrides: HashMap<String, bool> = HashMap::new();
    for ex in &excludes {
        if let PrereqSpec::Exclude { trigger, target, effect } = ex {
            if !matches!(raw_done.get(trigger).copied(), Some(true)) {
                continue;
            }
            let v = matches!(effect, ExcludeEffect::Satisfies);
            overrides.insert(target.clone(), v);
        }
    }

    let goal_by_id: HashMap<&str, &Goal> = goals.iter().map(|g| (g.id.as_str(), g)).collect();
    let is_done = |id: &str, required_count: u32| -> bool {
        // 1. excludes 强改写最优先
        if let Some(&v) = overrides.get(id) {
            return v;
        }
        // 2. countable 任务：按引用方 required_count 与 progress.current 比较
        if let Some(&g) = goal_by_id.get(id) {
            if g.countable {
                let need = required_count.max(1);
                return g.progress.as_ref().is_some_and(|p| p.current >= need);
            }
        }
        // 3. 普通任务：按自身 done 状态
        raw_done.get(id).copied().unwrap_or(false)
    };

    compute_unlocked(&ids, edges, &is_done)
}
