//! relations 业务逻辑 —— 包装 tracker-core 的 relations,加 cycle validate。
//!
//! relations.json 的读写与边容错在共享内核 `tracker-core::relations`，
//! 本文件只加 book 侧的 cycle 校验文案与 unlock 适配。

use std::collections::HashMap;
use std::path::Path;

use crate::types::{Book, BookStatus, Edge, UnlockResult};
use tracker_core::relations as data;
use tracker_core::unlock::{compute_unlocked, detect_cycles};
use tracker_core::validate::{format_issues, validate_edges};

/// 不变量校验的告警出口 —— **只警告，不阻止读写**。
///
/// 当前唯一检查是「同一个 `to` 只能有一条前置边」（详见 `tracker_core::validate`）：
/// 破坏它会让 `compute_unlocked` 静默丢弃前置条件。UI 的 upsert 语义保证了这点，
/// 但手工编辑 `relations.json` / 未来的导入路径不受此保护。
///
/// 要收紧成硬拒绝：把 `set_relations` 的 validate 闭包里这段警告改成返回 `Some(msg)`。
fn warn_invariants(edges: &[Edge], phase: &str) {
    if let Some(msg) = format_issues(&validate_edges(edges)) {
        eprintln!("[book-tracker][warn] {phase} relations: {msg}");
    }
}

/// 读 relations → 返回 edges(空数组兜底)。
///
/// 顺带跑一次不变量校验并告警：手工编辑 `relations.json` 是主要风险入口，
/// 读取时报告能让问题第一时间暴露，而不是等解锁结果算错才被察觉。
pub fn get_relations(data_dir: impl AsRef<Path>) -> std::io::Result<Vec<Edge>> {
    let file = data::read_relations(data_dir)?;
    warn_invariants(&file.edges, "读取");
    Ok(file.edges)
}

/// 写 relations(带 cycle 检测)。
///
/// cycle 仍然**硬拒绝**（会让环上作品永久锁死）；不变量问题目前只**告警**，
/// 不阻止写入 —— 避免历史数据一旦不合规就完全写不进去。
pub fn set_relations(data_dir: impl AsRef<Path>, edges: Vec<Edge>) -> std::io::Result<()> {
    warn_invariants(&edges, "写入");
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

/// 给定 books + edges,算 unlock map + cycles。
///
/// 适配共享内核:把"book → finished 判定"参数化为谓词。
/// book-tracker 没有 countable 任务 —— `required_count` 直接忽略。
pub fn compute_unlocked_for(books: &[Book], edges: &[Edge]) -> UnlockResult {
    let ids: Vec<String> = books.iter().map(|b| b.id.clone()).collect();
    let done: HashMap<String, bool> = books
        .iter()
        .map(|b| (b.id.clone(), matches!(b.status, BookStatus::Finished)))
        .collect();
    compute_unlocked(&ids, edges, &|id, _k| done.get(id).copied().unwrap_or(false))
}
