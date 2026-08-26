//! relations 业务逻辑 —— 包装 tracker-core 的 relations,加 cycle validate。
//!
//! relations.json 的读写与边容错在共享内核 `tracker-core::relations`，
//! 本文件只加 Goal 侧的 cycle 校验文案与 unlock 适配。
//!
//! v2 exclude 改写：在调用 `compute_unlocked` 前用 `collect_excludes` 收集所有
//! `ExcludeSpec`，先把 done map 改写一遍（disqualifies → false；satisfies → true），
//! 再传入 compute_unlocked。与 TS 端 `apps/life-tracker/src/shared/done.ts` 的
//! `buildDonePredicate` 语义一致。

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

/// 应用 ExcludeSpec 改写 done map（disqualifies → false；satisfies → true）。
/// 同一 target 多次改写取最后一次；trigger 未 done 时该规则不生效。
fn apply_excludes(done: &mut HashMap<String, bool>, excludes: &[PrereqSpec]) {
    for ex in excludes {
        if let PrereqSpec::Exclude { trigger, target, effect } = ex {
            if !matches!(done.get(trigger).copied(), Some(true)) {
                continue;
            }
            let v = matches!(effect, ExcludeEffect::Satisfies);
            done.insert(target.clone(), v);
        }
    }
}

/// 给定 goals + edges,算 unlock map + cycles。
///
/// 达成判定(与 TS `isGoalDone` 一致):status == Done,或量化进度已满(current >= total)。
/// v2: 应用所有 ExcludeSpec 改写 done map 后再算 unlock。
pub fn compute_unlocked_for(goals: &[Goal], edges: &[Edge]) -> UnlockResult {
    let ids: Vec<String> = goals.iter().map(|g| g.id.clone()).collect();
    let mut done: HashMap<String, bool> = goals
        .iter()
        .map(|g| {
            let complete = matches!(g.status, GoalStatus::Done)
                || g.progress
                    .as_ref()
                    .is_some_and(|p| p.total.is_some_and(|t| p.current >= t));
            (g.id.clone(), complete)
        })
        .collect();
    let excludes = collect_excludes(edges);
    apply_excludes(&mut done, &excludes);
    compute_unlocked(&ids, edges, &done)
}
