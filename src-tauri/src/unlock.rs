//! 解锁计算 —— 给定书列表 + 前置关系,算出每本书是否解锁。
//!
//! 规则(与 `src/shared/unlock.ts` 完全一致):
//! - `status == Finished` 才算"已读"
//! - `All`:所有前置 finished 才解锁
//! - `AnyOf`:至少 `threshold` 个前置 finished 才解锁(`threshold` 缺省 = 全部)
//! - 无前置:永远解锁
//! - 环上的书标 false 并报告环
//!
//! 纯函数,无副作用,带单测。

use std::collections::{HashMap, HashSet};

use crate::types::{Book, Edge, UnlockRule, UnlockResult};

/// 给定书列表 + 关系,计算每本书是否解锁。
pub fn compute_unlocked(books: &[Book], edges: &[Edge]) -> UnlockResult {
    let mut unlocked: HashMap<String, bool> = HashMap::new();
    let book_ids: HashSet<String> = books.iter().map(|b| b.id.clone()).collect();

    // 1. 检测循环依赖
    let cycles = detect_cycles(edges);
    let cycle_nodes: HashSet<String> = cycles.iter().flatten().cloned().collect();

    // 2. 计算每本书的前置边(过滤悬空引用)
    let mut edge_by_to: HashMap<String, Edge> = HashMap::new();
    for e in edges {
        let prereqs: Vec<String> = e
            .prerequisites
            .iter()
            .filter(|p| book_ids.contains(*p))
            .cloned()
            .collect();
        edge_by_to.insert(
            e.to.clone(),
            Edge {
                to: e.to.clone(),
                prerequisites: prereqs,
                rule: e.rule,
                threshold: e.threshold,
            },
        );
    }

    let finished = |id: &str| -> bool {
        books
            .iter()
            .find(|b| b.id == id)
            .is_some_and(|b| matches!(b.status, crate::types::BookStatus::Finished))
    };

    // 3. 迭代解锁(带 memo)
    //    用函数指针 + 闭包捕获 HashMap 引用;
    //    Rust 不允许递归闭包直接捕获自身,所以用内部 fn + &mut HashMap 参数。
    fn unlocked_of(
        id: &str,
        unlocked: &mut HashMap<String, bool>,
        cycle_nodes: &HashSet<String>,
        edge_by_to: &HashMap<String, Edge>,
        finished: &dyn Fn(&str) -> bool,
    ) -> bool {
        if let Some(&v) = unlocked.get(id) {
            return v;
        }
        if cycle_nodes.contains(id) {
            unlocked.insert(id.to_string(), false);
            return false;
        }
        let Some(edge) = edge_by_to.get(id) else {
            unlocked.insert(id.to_string(), true);
            return true;
        };
        if edge.prerequisites.is_empty() {
            unlocked.insert(id.to_string(), true);
            return true;
        }
        let done = edge.prerequisites.iter().filter(|p| finished(p)).count();
        let ok = match edge.rule {
            UnlockRule::All => done == edge.prerequisites.len(),
            UnlockRule::AnyOf => {
                let need = edge.threshold.unwrap_or(edge.prerequisites.len() as u32);
                done as u32 >= need
            }
        };
        unlocked.insert(id.to_string(), ok);
        ok
    }

    for b in books {
        unlocked_of(
            b.id.as_str(),
            &mut unlocked,
            &cycle_nodes,
            &edge_by_to,
            &finished,
        );
    }

    UnlockResult { unlocked, cycles }
}

/// DFS 检测循环,返回每个环涉及到的节点 id 列表(可能重叠)。
///
/// 构造反向邻接表(prereq → to),从每个节点做迭代式 DFS(三色标记),
/// 遇 GRAY 节点时截取当前路径栈得环。
///
/// 用迭代式 DFS 而非递归,避免 `&mut HashMap` 在递归调用中的借用冲突;
/// 同时 `String` 作为 map key 避开生命周期问题。
pub fn detect_cycles(edges: &[Edge]) -> Vec<Vec<String>> {
    // 反向邻接:prereq 依赖者列表
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for e in edges {
        for prereq in &e.prerequisites {
            adj.entry(prereq.clone()).or_default().push(e.to.clone());
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Color {
        White,
        Gray,
        Black,
    }

    let mut color: HashMap<String, Color> = HashMap::new();
    let mut cycles: Vec<Vec<String>> = Vec::new();

    let nodes: Vec<String> = adj.keys().cloned().collect();
    for start in &nodes {
        if color.get(start).copied().unwrap_or(Color::White) != Color::White {
            continue;
        }
        // 迭代式 DFS:栈帧 = (节点, 当前邻接子节点的索引)
        let mut stack: Vec<(String, usize)> = vec![(start.clone(), 0)];
        color.insert(start.clone(), Color::Gray);

        while let Some((node, idx)) = stack.last().cloned() {
            let nexts = adj.get(&node).cloned().unwrap_or_default();
            if idx >= nexts.len() {
                // 当前节点的邻居都遍历完,标黑回溯
                color.insert(node.clone(), Color::Black);
                stack.pop();
                continue;
            }
            // 更新栈帧的索引(下一轮迭代看下一个邻居)
            stack.last_mut().unwrap().1 = idx + 1;
            let next = &nexts[idx];

            match color.get(next).copied().unwrap_or(Color::White) {
                Color::Gray => {
                    // 找到环:从栈中找到 next 出现位置到末尾 + next 闭合
                    if let Some(pos) = stack.iter().position(|(n, _)| n == next) {
                        let mut cycle: Vec<String> =
                            stack[pos..].iter().map(|(n, _)| n.clone()).collect();
                        cycle.push(next.clone());
                        cycles.push(cycle);
                    }
                }
                Color::Black => {}
                Color::White => {
                    color.insert(next.clone(), Color::Gray);
                    stack.push((next.clone(), 0));
                }
            }
        }
    }

    cycles
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Book, BookStatus, Edge, UnlockRule};

    fn mk_book(id: &str, status: BookStatus) -> Book {
        Book {
            id: id.to_string(),
            title: id.to_string(),
            author: "a".to_string(),
            country: "c".to_string(),
            year: 2000,
            translator: String::new(),
            status,
            read_count: 1,
            progress: None,
            created: "2024-01-01T00:00:00.000Z".to_string(),
            updated: "2024-01-01T00:00:00.000Z".to_string(),
            tags: vec![],
        }
    }

    #[test]
    fn no_prereq_always_unlocked() {
        let books = vec![mk_book("a", BookStatus::Want)];
        let r = compute_unlocked(&books, &[]);
        assert_eq!(r.unlocked.get("a"), Some(&true));
    }

    #[test]
    fn rule_all_requires_all_finished() {
        let books = vec![
            mk_book("a", BookStatus::Finished),
            mk_book("b", BookStatus::Want),
            mk_book("c", BookStatus::Want),
        ];
        let edges = vec![Edge {
            to: "c".to_string(),
            prerequisites: vec!["a".to_string(), "b".to_string()],
            rule: UnlockRule::All,
            threshold: None,
        }];
        let r = compute_unlocked(&books, &edges);
        assert_eq!(r.unlocked.get("a"), Some(&true));
        assert_eq!(r.unlocked.get("b"), Some(&true));
        assert_eq!(r.unlocked.get("c"), Some(&false));

        let books2 = vec![
            mk_book("a", BookStatus::Finished),
            mk_book("b", BookStatus::Finished),
            mk_book("c", BookStatus::Want),
        ];
        let r2 = compute_unlocked(&books2, &edges);
        assert_eq!(r2.unlocked.get("c"), Some(&true));
    }

    #[test]
    fn rule_any_of_uses_threshold() {
        let books = vec![
            mk_book("a", BookStatus::Finished),
            mk_book("b", BookStatus::Finished),
            mk_book("c", BookStatus::Want),
            mk_book("target", BookStatus::Want),
        ];
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: vec!["a".to_string(), "b".to_string(), "c".to_string()],
            rule: UnlockRule::AnyOf,
            threshold: Some(2),
        }];
        let r = compute_unlocked(&books, &edges);
        assert_eq!(r.unlocked.get("target"), Some(&true));

        // 改成只剩 a finished → 不够 threshold
        let books2 = vec![
            mk_book("a", BookStatus::Finished),
            mk_book("b", BookStatus::Want),
            mk_book("c", BookStatus::Want),
            mk_book("target", BookStatus::Want),
        ];
        let r2 = compute_unlocked(&books2, &edges);
        assert_eq!(r2.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn only_finished_counts() {
        let books = vec![
            mk_book("a", BookStatus::Abandoned),
            mk_book("b", BookStatus::Shelved),
            mk_book("c", BookStatus::Reading),
            mk_book("target", BookStatus::Want),
        ];
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: vec!["a".to_string(), "b".to_string(), "c".to_string()],
            rule: UnlockRule::All,
            threshold: None,
        }];
        let r = compute_unlocked(&books, &edges);
        assert_eq!(r.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn cycle_books_are_blocked_and_reported() {
        let books = vec![mk_book("a", BookStatus::Want), mk_book("b", BookStatus::Want)];
        let edges = vec![
            Edge {
                to: "a".to_string(),
                prerequisites: vec!["b".to_string()],
                rule: UnlockRule::All,
                threshold: None,
            },
            Edge {
                to: "b".to_string(),
                prerequisites: vec!["a".to_string()],
                rule: UnlockRule::All,
                threshold: None,
            },
        ];
        let r = compute_unlocked(&books, &edges);
        assert_eq!(r.unlocked.get("a"), Some(&false));
        assert_eq!(r.unlocked.get("b"), Some(&false));
        assert!(!r.cycles.is_empty(), "should report at least one cycle");
    }

    #[test]
    fn dangling_refs_are_silently_ignored() {
        let books = vec![
            mk_book("a", BookStatus::Finished),
            mk_book("target", BookStatus::Want),
        ];
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: vec!["a".to_string(), "ghost".to_string()],
            rule: UnlockRule::All,
            threshold: None,
        }];
        let r = compute_unlocked(&books, &edges);
        assert_eq!(r.unlocked.get("target"), Some(&true));
    }

    #[test]
    fn detect_cycles_acyclic_returns_empty() {
        let edges = vec![Edge {
            to: "b".to_string(),
            prerequisites: vec!["a".to_string()],
            rule: UnlockRule::All,
            threshold: None,
        }];
        assert!(detect_cycles(&edges).is_empty());
    }

    #[test]
    fn detect_cycles_self_loop_detected() {
        let edges = vec![Edge {
            to: "a".to_string(),
            prerequisites: vec!["a".to_string()],
            rule: UnlockRule::All,
            threshold: None,
        }];
        assert!(!detect_cycles(&edges).is_empty());
    }
}
