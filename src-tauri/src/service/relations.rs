//! relations 业务逻辑 —— 包装 data/relations,加 cycle validate。

use std::path::Path;

use crate::data::relations as data;
use crate::types::{Edge, UnlockResult};
use crate::unlock::{compute_unlocked, detect_cycles};

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
/// 这里的 books 参数来自 renderer(已加载的 book 列表),不在 service 里再读盘。
pub fn compute_unlocked_for(books: &[Book], edges: &[Edge]) -> UnlockResult {
    compute_unlocked(books, edges)
}

use crate::types::Book;
