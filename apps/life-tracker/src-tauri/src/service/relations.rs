//! relations 业务逻辑 —— 包装 tracker-core 的 relations,加 cycle validate。
//!
//! relations.json 的读写与边容错在共享内核 `tracker-core::relations`，
//! 本文件只加 Goal 侧的 cycle 校验文案与 unlock 适配。

use std::collections::HashMap;
use std::path::Path;

use crate::types::{Edge, Goal, GoalStatus, UnlockResult};
use tracker_core::relations as data;
use tracker_core::unlock::{compute_unlocked, detect_cycles};

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
pub fn compute_unlocked_for(goals: &[Goal], edges: &[Edge]) -> UnlockResult {
    let ids: Vec<String> = goals.iter().map(|g| g.id.clone()).collect();
    let done: HashMap<String, bool> = goals
        .iter()
        .map(|g| {
            let complete = matches!(g.status, GoalStatus::Done)
                || g.progress
                    .as_ref()
                    .is_some_and(|p| p.total.is_some_and(|t| p.current >= t));
            (g.id.clone(), complete)
        })
        .collect();
    compute_unlocked(&ids, edges, &done)
}
