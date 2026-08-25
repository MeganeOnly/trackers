//! relations 业务逻辑 —— 包装 tracker-core 的 relations,加 cycle validate。
//!
//! relations.json 的读写与边容错在共享内核 `tracker-core::relations`，
//! 本文件只加 book 侧的 cycle 校验文案与 unlock 适配。

use std::collections::HashMap;
use std::path::Path;

use crate::types::{Book, BookStatus, Edge, UnlockResult};
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

/// 给定 books + edges,算 unlock map + cycles。
///
/// 适配共享内核:把"book → finished 判定"参数化为 done map。
pub fn compute_unlocked_for(books: &[Book], edges: &[Edge]) -> UnlockResult {
    let ids: Vec<String> = books.iter().map(|b| b.id.clone()).collect();
    let done: HashMap<String, bool> = books
        .iter()
        .map(|b| (b.id.clone(), matches!(b.status, BookStatus::Finished)))
        .collect();
    compute_unlocked(&ids, edges, &done)
}
