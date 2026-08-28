//! 解锁计算 —— 给定条目 id 列表 + 前置关系 + 完成 map，计算每个条目是否解锁。
//!
//! 与 `packages/tracker-core/src/unlock.ts` 逻辑一致，参数化后两个 app 共用：
//! - book-tracker: 传书 id + `done = { id: status==finished }`
//! - life-tracker:  传目标 id + 自己的完成判定（status / 里程碑达成等）
//!
//! 规则（v2）：
//! - v2 specs 路径（AND-of-specs）有正向 spec 时优先
//! - 旧 `groups` 路径（AND-of-ORs）其次
//! - 否则按 `rule + threshold` 路径
//! - 无前置：永远解锁
//! - 环上的条目标 false 并报告环
//!
//! 应用层职责：调用本函数前，用所有 `exclude` 改写 `done` 谓词；
//! 本函数本身不感知 exclude。

use std::collections::{HashMap, HashSet};

use crate::types::{Edge, ExcludeEffect, PrereqSpec, UnlockResult, UnlockRule};
#[cfg(test)]
use crate::types::GroupMember;

/// 单个 spec 是否『满足』（exclude 在此永真，由谓词改写处理）。
///
/// v3：group members 支持 per-member count（`WithCount { id, count }` 形态）；
/// string 形态与 `Count` 内部成员按 1 次处理（一次"已达成"算一次 done 单位）。
/// 应用层 isDone 谓词负责把 countable 任务的 `progress.current >= count` 翻译成 true。
fn is_spec_satisfied<F: Fn(&str, u32) -> bool>(
    spec: &PrereqSpec,
    is_done: &F,
) -> bool {
    match spec {
        PrereqSpec::Simple { id, count } => {
            let need = count.unwrap_or(1);
            is_done(id, need)
        }
        PrereqSpec::Group { members, pick } => {
            let need = pick.unwrap_or(1);
            let hit = members
                .iter()
                .filter(|m| is_done(m.id(), m.count()))
                .count() as u32;
            hit >= need
        }
        PrereqSpec::Count { members, need } => {
            let hit = members
                .iter()
                .filter(|m| is_done(m, 1))
                .count() as u32;
            hit >= *need
        }
        PrereqSpec::Exclude { .. } => true, // exclude 不参与正向 AND；谓词已改写
    }
}

/// 节点在依赖图中的双向关系：
/// - `blocks` —— 我**直接**阻塞的下游节点（完成我会推动它们的解锁进度）
/// - `blocked_by` —— 我**直接**被哪些上游节点阻塞（解锁我还需要这些先完成）
///
/// 仅含**直接**一步可达的邻居；不做传递闭包（避免把整张图塞进每个节点）。
/// UI 需要"完成我会解锁 X、Y、Z（链式传递）"时，可在调用方基于 `blocks` 自己 BFS。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BlockingRelation {
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
}

/// 给定条目 id 列表 + 关系 + 完成谓词，计算每个条目是否解锁。
///
/// `is_done(id, required_count)`：
/// - 普通目标：required_count 不影响判断（只看自身 done 状态）
/// - countable 目标：要求 progress.current >= required_count
///
/// 应用层在使用前先收集所有 `ExcludeSpec` 改写谓词（disqualifies → false；
/// satisfies → true）；本函数本身不感知 exclude。
pub fn compute_unlocked<F: Fn(&str, u32) -> bool>(
    ids: &[String],
    edges: &[Edge],
    is_done: &F,
) -> UnlockResult {
    let mut unlocked: HashMap<String, bool> = HashMap::new();
    let id_set: HashSet<String> = ids.iter().cloned().collect();

    // 1. 检测循环依赖
    let cycles = detect_cycles(edges);
    let cycle_nodes: HashSet<String> = cycles.iter().flatten().cloned().collect();

    // 2. 计算每条前置边（过滤悬空引用）
    let mut edge_by_to: HashMap<String, Edge> = HashMap::new();
    for e in edges {
        let prereqs: Vec<String> = e
            .prerequisites
            .iter()
            .filter(|p| id_set.contains(*p))
            .cloned()
            .collect();
        // 仅保留正向 spec（exclude 不算）
        let specs_positive: Option<Vec<PrereqSpec>> = match &e.specs {
            Some(list) => {
                let pos: Vec<PrereqSpec> = list
                    .iter()
                    .filter(|s| !matches!(s, PrereqSpec::Exclude { .. }))
                    .cloned()
                    .collect();
                if pos.is_empty() { None } else { Some(pos) }
            }
            None => None,
        };
        edge_by_to.insert(
            e.to.clone(),
            Edge {
                to: e.to.clone(),
                prerequisites: prereqs,
                rule: e.rule,
                threshold: e.threshold,
                groups: e.groups.as_ref().filter(|g| !g.is_empty()).cloned(),
                specs: specs_positive,
                excludes: e.excludes.clone(),
            },
        );
    }

    // 3. 迭代解锁（带 memo）
    //    用内部 fn + &mut HashMap 参数，避开递归闭包借用冲突。
    fn unlocked_of<F: Fn(&str, u32) -> bool>(
        id: &str,
        unlocked: &mut HashMap<String, bool>,
        cycle_nodes: &HashSet<String>,
        edge_by_to: &HashMap<String, Edge>,
        is_done: &F,
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
        // v2 specs 路径（AND-of-specs）优先
        if let Some(specs) = &edge.specs {
            if !specs.is_empty() {
                let ok = specs.iter().all(|s| is_spec_satisfied(s, is_done));
                unlocked.insert(id.to_string(), ok);
                return ok;
            }
        }
        let done_count = edge
            .prerequisites
            .iter()
            .filter(|p| is_done(p, 1))
            .count();
        let ok = match &edge.groups {
            // 二选一组合语义：必选项全部 done 且 每个组至少一个 done
            Some(groups) if !groups.is_empty() => {
                let in_group: HashSet<&String> = groups.iter().flatten().collect();
                let mandatory_ok = edge
                    .prerequisites
                    .iter()
                    .filter(|p| !in_group.contains(p))
                    .all(|p| is_done(p, 1));
                let groups_ok = groups
                    .iter()
                    .all(|g| g.iter().any(|p| is_done(p, 1)));
                mandatory_ok && groups_ok
            }
            _ => match edge.rule {
                UnlockRule::All => done_count == edge.prerequisites.len(),
                UnlockRule::AnyOf => {
                    let need = edge.threshold.unwrap_or(edge.prerequisites.len() as u32);
                    done_count as u32 >= need
                }
            },
        };
        unlocked.insert(id.to_string(), ok);
        ok
    }

    for id in ids {
        unlocked_of(id, &mut unlocked, &cycle_nodes, &edge_by_to, is_done);
    }

    UnlockResult { unlocked, cycles }
}

/// DFS 检测循环，返回每个环涉及到的节点 id 列表（可能重叠）。
///
/// 构造反向邻接表（prereq → to），从每个节点做迭代式 DFS（三色标记），
/// 遇 GRAY 节点时截取当前路径栈得环。
pub fn detect_cycles(edges: &[Edge]) -> Vec<Vec<String>> {
    // 反向邻接：prereq 依赖者列表
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
        // 迭代式 DFS：栈帧 = (节点, 当前邻接子节点的索引)
        let mut stack: Vec<(String, usize)> = vec![(start.clone(), 0)];
        color.insert(start.clone(), Color::Gray);

        while let Some((node, idx)) = stack.last().cloned() {
            let nexts = adj.get(&node).cloned().unwrap_or_default();
            if idx >= nexts.len() {
                color.insert(node.clone(), Color::Black);
                stack.pop();
                continue;
            }
            stack.last_mut().unwrap().1 = idx + 1;
            let next = &nexts[idx];

            match color.get(next).copied().unwrap_or(Color::White) {
                Color::Gray => {
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

/// 收集所有 edges 中出现的 ExcludeSpec，去重（trigger+target+effect）。
/// 应用层用这个建 done 谓词的改写层。
pub fn collect_excludes(edges: &[Edge]) -> Vec<PrereqSpec> {
    let mut seen: HashSet<(String, String, &'static str)> = HashSet::new();
    let mut out: Vec<PrereqSpec> = Vec::new();
    for e in edges {
        // edge.excludes 字段 + edge.specs 里的 exclude 项都收集
        let mut all: Vec<PrereqSpec> = Vec::new();
        if let Some(list) = &e.excludes {
            all.extend(list.iter().cloned());
        }
        if let Some(list) = &e.specs {
            for s in list {
                if matches!(s, PrereqSpec::Exclude { .. }) {
                    all.push(s.clone());
                }
            }
        }
        for s in all {
            if let PrereqSpec::Exclude { trigger, target, effect } = s {
                let key_tag: &'static str = match effect {
                    ExcludeEffect::Disqualifies => "disqualifies",
                    ExcludeEffect::Satisfies => "satisfies",
                };
                let key = (trigger.clone(), target.clone(), key_tag);
                if seen.contains(&key) {
                    continue;
                }
                seen.insert(key);
                out.push(PrereqSpec::Exclude { trigger, target, effect });
            }
        }
    }
    out
}

/// 计算关系图中每个节点的**直接**双向邻居：`blocks`（下游）与 `blocked_by`（上游）。
///
/// 语义要点：
/// - 仅走 `edge.prerequisites` + `edge.specs`（simple / group / count 成员）—— **`exclude`
///   不算正向引用**，它是谓词改写规则，不会单独建立一条"我在阻塞谁"的边。
/// - 同一对节点若被多条 edge 重复指向，会被去重（BTreeSet 收尾 + 物化成 `Vec`）。
/// - 不存在的节点 id 也会出现在 Map 里（值是空 Vec）—— 这样调用方按 id 取 `.blocks`
///   不会拿到默认值。Map 的 key 集合 == 出现在任意 edge 两端的 id 全集。
/// - 不做传递闭包：`A → B → C` 中 `A.blocks = [B]`、`B.blocks = [C]`，需要链式影响自己 BFS。
/// - 时间 O(E)，空间 O(N + E)。
pub fn compute_blocking_relations(edges: &[Edge]) -> HashMap<String, BlockingRelation> {
    let mut blocks: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
    let mut blocked_by: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();

    fn ensure(
        blocks: &mut HashMap<String, std::collections::BTreeSet<String>>,
        blocked_by: &mut HashMap<String, std::collections::BTreeSet<String>>,
        id: &str,
    ) {
        blocks.entry(id.to_string()).or_default();
        blocked_by.entry(id.to_string()).or_default();
    }

    for e in edges {
        let refs = collect_prereq_ids(e);
        if refs.is_empty() {
            continue;
        }
        // e.to 被 refs 中每个 id 阻塞；refs 中每个 id 阻塞 e.to
        ensure(&mut blocks, &mut blocked_by, &e.to);
        let to_blocked = blocked_by.get_mut(&e.to).expect("just ensured");
        for r in &refs {
            to_blocked.insert(r.clone());
        }
        for r in &refs {
            ensure(&mut blocks, &mut blocked_by, r);
            blocks.get_mut(r).expect("just ensured").insert(e.to.clone());
        }
    }

    // 物化成 BlockingRelation；合并两表的 key
    let mut all_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    all_ids.extend(blocks.keys().cloned());
    all_ids.extend(blocked_by.keys().cloned());

    all_ids
        .into_iter()
        .map(|id| {
            let rel = BlockingRelation {
                blocks: blocks.get(&id).cloned().unwrap_or_default().into_iter().collect(),
                blocked_by: blocked_by.get(&id).cloned().unwrap_or_default().into_iter().collect(),
            };
            (id, rel)
        })
        .collect()
}

/// 取一条 edge 的全部正向引用 id（来自 prerequisites + specs 中的 simple / group / count）。
fn collect_prereq_ids(edge: &Edge) -> Vec<String> {
    let mut ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for p in &edge.prerequisites {
        ids.insert(p.clone());
    }
    if let Some(specs) = &edge.specs {
        for s in specs {
            match s {
                PrereqSpec::Simple { id, .. } => {
                    ids.insert(id.clone());
                }
                PrereqSpec::Group { members, .. } => {
                    for m in members {
                        ids.insert(m.id().to_string());
                    }
                }
                PrereqSpec::Count { members, .. } => {
                    for m in members {
                        ids.insert(m.clone());
                    }
                }
                PrereqSpec::Exclude { .. } => {
                    // exclude 不参与正向引用
                }
            }
        }
    }
    ids.into_iter().collect()
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::UnlockRule;

    fn ids(ls: &[&str]) -> Vec<String> {
        ls.iter().map(|s| s.to_string()).collect()
    }

    fn done_map(finished: &[&str]) -> HashMap<String, bool> {
        finished.iter().map(|s| (s.to_string(), true)).collect()
    }

    /// 把 owned `HashMap<String, bool>` 转成 `Fn(&str, u32) -> bool` 闭包，
    /// 适配 compute_unlocked 新签名。`required_count` 被忽略。
    fn done_fn(done: HashMap<String, bool>) -> impl Fn(&str, u32) -> bool {
        move |id, _k| done.get(id).copied().unwrap_or(false)
    }

    fn edge(to: &str, prereqs: &[&str], rule: UnlockRule) -> Edge {
        Edge {
            to: to.to_string(),
            prerequisites: prereqs.iter().map(|s| s.to_string()).collect(),
            rule,
            ..Default::default()
        }
    }

    #[test]
    fn no_prereq_always_unlocked() {
        let r = compute_unlocked(&ids(&["a"]), &[], &done_fn(done_map(&[])));
        assert_eq!(r.unlocked.get("a"), Some(&true));
    }

    #[test]
    fn rule_all_requires_all_done() {
        let edges = vec![edge("c", &["a", "b"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b", "c"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("a"), Some(&true));
        assert_eq!(r.unlocked.get("b"), Some(&true));
        assert_eq!(r.unlocked.get("c"), Some(&false));

        let r2 = compute_unlocked(&ids(&["a", "b", "c"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert_eq!(r2.unlocked.get("c"), Some(&true));
    }

    #[test]
    fn rule_any_of_uses_threshold() {
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a", "b", "c"]),
            rule: UnlockRule::AnyOf,
            threshold: Some(2),
            ..Default::default()
        }];
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert_eq!(r.unlocked.get("target"), Some(&true));

        let r2 = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r2.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn not_done_does_not_count() {
        // done map 中没有的条目视为未完成
        let edges = vec![edge("target", &["a", "b", "c"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&[])));
        assert_eq!(r.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn cycle_items_are_blocked_and_reported() {
        let edges = vec![edge("a", &["b"], UnlockRule::All), edge("b", &["a"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b"]), &edges, &done_fn(done_map(&[])));
        assert_eq!(r.unlocked.get("a"), Some(&false));
        assert_eq!(r.unlocked.get("b"), Some(&false));
        assert!(!r.cycles.is_empty(), "should report at least one cycle");
    }

    #[test]
    fn dangling_refs_are_silently_ignored() {
        let edges = vec![edge("target", &["a", "ghost"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("target"), Some(&true));
    }

    #[test]
    fn detect_cycles_acyclic_returns_empty() {
        let edges = vec![edge("b", &["a"], UnlockRule::All)];
        assert!(detect_cycles(&edges).is_empty());
    }

    #[test]
    fn detect_cycles_self_loop_detected() {
        let edges = vec![edge("a", &["a"], UnlockRule::All)];
        assert!(!detect_cycles(&edges).is_empty());
    }

    #[test]
    fn groups_or_choose_one_plus_mandatory() {
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a", "b", "c"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: Some(vec![ids(&["a", "b"])]),
            ..Default::default()
        }];
        // c 必须 + a/b 二选一
        let ok = |r: &UnlockResult| r.unlocked.get("target").copied().unwrap_or(false);
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["a", "c"])));
        assert!(ok(&r));
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["b", "c"])));
        assert!(ok(&r));
        // 缺 c → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert!(!ok(&r));
        // 组内一个都没完成 → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_fn(done_map(&["c"])));
        assert!(!ok(&r));
    }

    #[test]
    fn groups_multiple_all_required() {
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a", "b", "c", "d"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: Some(vec![ids(&["a", "b"]), ids(&["c", "d"])]),
            ..Default::default()
        }];
        let ok = |r: &UnlockResult| r.unlocked.get("target").copied().unwrap_or(false);
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "target"]), &edges, &done_fn(done_map(&["a", "c"])));
        assert!(ok(&r));
        // 只满足第一组 → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert!(!ok(&r));
    }

    #[test]
    fn groups_empty_falls_back_to_all() {
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a", "b"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: Some(vec![]),
            ..Default::default()
        }];
        let ok = |r: &UnlockResult| r.unlocked.get("target").copied().unwrap_or(false);
        let r = compute_unlocked(&ids(&["a", "b", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert!(!ok(&r));
        let r = compute_unlocked(&ids(&["a", "b", "target"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert!(ok(&r));
    }

    #[test]
    fn groups_dangling_member_ok_but_all_dangling_locks() {
        // 组内有真实成员完成即满足；悬空成员不阻塞
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: Some(vec![ids(&["a", "ghost"])]),
            ..Default::default()
        }];
        let r = compute_unlocked(&ids(&["a", "target"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("target"), Some(&true));

        // 组全悬空 → 永不满足 → 锁
        let edges2 = vec![Edge {
            to: "target".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: Some(vec![ids(&["ghost1", "ghost2"])]),
            ..Default::default()
        }];
        let r2 = compute_unlocked(&ids(&["a", "target"]), &edges2, &done_fn(done_map(&[])));
        assert_eq!(r2.unlocked.get("target"), Some(&false));
    }

    // ========== v2 specs / excludes ==========

    fn rewrite_done<'a, F: Fn(&str, u32) -> bool>(
        is_done: &'a F,
        excludes: &'a [PrereqSpec],
    ) -> impl Fn(&str, u32) -> bool + 'a {
        let mut overrides: HashMap<String, bool> = HashMap::new();
        for ex in excludes {
            if let PrereqSpec::Exclude { trigger, target, effect } = ex {
                if is_done(trigger, 1) {
                    overrides.insert(target.clone(), matches!(effect, ExcludeEffect::Satisfies));
                }
            }
        }
        move |id, _k| {
            if let Some(&v) = overrides.get(id) {
                return v;
            }
            is_done(id, 1)
        }
    }

    #[test]
    fn specs_simple_satisfied_when_id_done() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Simple { id: "a".to_string(), count: None }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "t"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("t"), Some(&true));
        let r = compute_unlocked(&ids(&["a", "t"]), &edges, &done_fn(done_map(&[])));
        assert_eq!(r.unlocked.get("t"), Some(&false));
    }

    #[test]
    fn specs_simple_count_passes_required_to_predicate() {
        // 模拟可计数任务的进度谓词：progress.current 必须 >= 引用方要求的次数。
        // progress = { sci: 1 } → count=2 不满足；count=1 满足
        let progress: HashMap<String, u32> = [("sci".to_string(), 1)].into_iter().collect();
        let is_done = |id: &str, k: u32| -> bool { progress.get(id).copied().unwrap_or(0) >= k };
        let edges = vec![Edge {
            to: "award".to_string(),
            prerequisites: ids(&["sci"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Simple {
                id: "sci".to_string(),
                count: Some(2),
            }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["sci", "award"]), &edges, &is_done);
        assert_eq!(r.unlocked.get("award"), Some(&false));
        // 进度涨到 2 → 解锁
        let progress2: HashMap<String, u32> = [("sci".to_string(), 2)].into_iter().collect();
        let is_done2 = |id: &str, k: u32| -> bool { progress2.get(id).copied().unwrap_or(0) >= k };
        let r = compute_unlocked(&ids(&["sci", "award"]), &edges, &is_done2);
        assert_eq!(r.unlocked.get("award"), Some(&true));
    }

    #[test]
    fn specs_simple_count_none_equivalent_to_count_1() {
        // count=None 与 count=Some(1) 等价
        let is_done = |id: &str, _k: u32| -> bool { id == "a" };
        let edges_none = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Simple { id: "a".to_string(), count: None }]),
            excludes: None,
        }];
        let edges_one = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Simple {
                id: "a".to_string(),
                count: Some(1),
            }]),
            excludes: None,
        }];
        let r_none = compute_unlocked(&ids(&["a", "t"]), &edges_none, &is_done);
        let r_one = compute_unlocked(&ids(&["a", "t"]), &edges_one, &is_done);
        assert_eq!(r_none.unlocked.get("t"), r_one.unlocked.get("t"));
    }

    #[test]
    fn specs_group_pick_n_of_m() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a", "b", "c", "d"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Group {
                members: ids(&["a", "b", "c", "d"])
                    .into_iter()
                    .map(GroupMember::Id)
                    .collect(),
                pick: Some(2),
            }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "t"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "t"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }

    #[test]
    fn specs_count_need_n() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a", "b", "c"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Count {
                members: ids(&["a", "b", "c"]),
                need: 2,
            }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "b", "c", "t"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "c", "t"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }

    #[test]
    fn exclude_disqualifies_blocks_via_rewrite() {
        // 经典场景：所长奖学金获得者原则上不再参选冠名奖学金
        let edges = vec![Edge {
            to: "mainAward".to_string(),
            prerequisites: ids(&["namedAward"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: None,
            excludes: Some(vec![PrereqSpec::Exclude {
                trigger: "chiefAward".to_string(),
                target: "namedAward".to_string(),
                effect: ExcludeEffect::Disqualifies,
            }]),
        }];
        let excludes = collect_excludes(&edges);
        // 没拿到所长 → namedAward done → 解锁
        let base = done_fn(done_map(&["namedAward"]));
        let done = rewrite_done(&base, &excludes);
        let r = compute_unlocked(
            &ids(&["chiefAward", "namedAward", "mainAward"]),
            &edges,
            &done,
        );
        assert_eq!(r.unlocked.get("mainAward"), Some(&true));
        // 拿到所长 → namedAward 被 disqualify → 锁
        let base2 = done_fn(done_map(&["chiefAward", "namedAward"]));
        let done = rewrite_done(&base2, &excludes);
        let r = compute_unlocked(
            &ids(&["chiefAward", "namedAward", "mainAward"]),
            &edges,
            &done,
        );
        assert_eq!(r.unlocked.get("mainAward"), Some(&false));
    }

    #[test]
    fn exclude_satisfies_marks_done_via_rewrite() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["B"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: None,
            excludes: Some(vec![PrereqSpec::Exclude {
                trigger: "A".to_string(),
                target: "B".to_string(),
                effect: ExcludeEffect::Satisfies,
            }]),
        }];
        let excludes = collect_excludes(&edges);
        // 仅 A done → B 视为 done → t 解锁
        let base3 = done_fn(done_map(&["A"]));
        let done = rewrite_done(&base3, &excludes);
        let r = compute_unlocked(&ids(&["A", "B", "t"]), &edges, &done);
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }

    #[test]
    fn collect_excludes_dedupes_by_triple() {
        let x = PrereqSpec::Exclude {
            trigger: "a".to_string(),
            target: "b".to_string(),
            effect: ExcludeEffect::Disqualifies,
        };
        let edges = vec![
            Edge {
                to: "t1".to_string(),
                prerequisites: ids(&["b"]),
                rule: UnlockRule::All,
                threshold: None,
                groups: None,
                specs: None,
                excludes: Some(vec![x.clone()]),
            },
            Edge {
                to: "t2".to_string(),
                prerequisites: ids(&["b"]),
                rule: UnlockRule::All,
                threshold: None,
                groups: None,
                specs: Some(vec![x]),
                excludes: None,
            },
        ];
        assert_eq!(collect_excludes(&edges).len(), 1);
    }

    #[test]
    fn backward_compat_no_specs_uses_old_path() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a", "b"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: None,
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "b", "t"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "t"]), &edges, &done_fn(done_map(&["a", "b"])));
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }

    // ========== v3 group per-member count ==========

    /// 模拟 life-tracker 应用层 isDone：countable 任务用 progress.current 比较，
    /// 普通任务用 done set。返回 `Fn(&str, u32) -> bool`。
    fn done_with_counts(
        progress: &[(&str, u32)],
        raw_done: &[&str],
    ) -> impl Fn(&str, u32) -> bool {
        let prog: std::collections::HashMap<String, u32> =
            progress.iter().map(|(k, v)| ((*k).to_string(), *v)).collect();
        let raw: std::collections::HashSet<String> =
            raw_done.iter().map(|s| (*s).to_string()).collect();
        move |id, k| match prog.get(id) {
            Some(&cur) => cur >= k,
            None => raw.contains(id),
        }
    }

    fn group_m(
        items: &[(&str, u32)],
    ) -> Vec<GroupMember> {
        items
            .iter()
            .map(|(id, c)| {
                if *c <= 1 {
                    GroupMember::Id((*id).to_string())
                } else {
                    GroupMember::WithCount { id: (*id).to_string(), count: *c }
                }
            })
            .collect()
    }

    #[test]
    fn specs_group_per_member_count_below_required() {
        // group [{B,2}, C] pick=1：B=1 不满足（仍需要 C）
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["B", "C"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Group {
                members: group_m(&[("B", 2), ("C", 1)]),
                pick: Some(1),
            }]),
            excludes: None,
        }];
        let is_done = done_with_counts(&[("B", 1)], &["C"]);
        assert_eq!(
            compute_unlocked(&ids(&["B", "C", "t"]), &edges, &is_done).unlocked.get("t"),
            Some(&true)
        );
    }

    #[test]
    fn specs_group_per_member_count_meets_required() {
        // group [{B,2}, C] pick=1：B=2 即满足
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["B"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Group {
                members: group_m(&[("B", 2), ("C", 1)]),
                pick: Some(1),
            }]),
            excludes: None,
        }];
        let is_done = done_with_counts(&[("B", 2)], &[]);
        assert_eq!(
            compute_unlocked(&ids(&["B", "C", "t"]), &edges, &is_done).unlocked.get("t"),
            Some(&true)
        );
    }

    #[test]
    fn specs_group_string_form_backward_compat() {
        // 旧 ["a", "b"] 形态仍按 requiredCount=1 计算
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a", "b"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Group {
                members: ids(&["a", "b"])
                    .into_iter()
                    .map(GroupMember::Id)
                    .collect(),
                pick: Some(1),
            }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "b", "t"]), &edges, &done_fn(done_map(&["a"])));
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }

    #[test]
    fn specs_group_per_count_serde_roundtrip() {
        // 写盘形态 [{id,count}] 与 ["id"] 互转一致
        let with_count = vec![PrereqSpec::Group {
            members: group_m(&[("B", 2), ("C", 1)]),
            pick: Some(1),
        }];
        let s = serde_json::to_string(&with_count).unwrap();
        // count=1 的 C 序列化为字符串；B 序列化为 {id, count}
        assert!(s.contains("\"id\":\"B\",\"count\":2"), "got: {s}");
        assert!(s.contains("\"C\""), "got: {s}");
        // 反序列化
        let back: Vec<PrereqSpec> = serde_json::from_str(&s).unwrap();
        assert_eq!(back, with_count);
    }

    #[test]
    fn specs_group_per_count_old_data_loads() {
        // 旧 data 形如 ["a", "b"] 也能直接 deserialize 成新形态（向后兼容）
        let s = r#"["a","b"]"#;
        let m: Vec<GroupMember> = serde_json::from_str(s).unwrap();
        assert_eq!(m, vec![GroupMember::Id("a".to_string()), GroupMember::Id("b".to_string())]);
    }

    // ========== compute_blocking_relations ==========

    fn rel<'a>(map: &'a HashMap<String, BlockingRelation>, id: &str) -> &'a BlockingRelation {
        map.get(id).unwrap_or_else(|| panic!("missing id: {id}"))
    }

    #[test]
    fn blocking_relations_empty() {
        let r = compute_blocking_relations(&[]);
        assert!(r.is_empty());
    }

    #[test]
    fn blocking_relations_single_edge() {
        // a → b: a.blocks=[b], b.blocked_by=[a]
        let edges = vec![edge("b", &["a"], UnlockRule::All)];
        let r = compute_blocking_relations(&edges);
        assert_eq!(rel(&r, "a").blocks, vec!["b".to_string()]);
        assert!(rel(&r, "a").blocked_by.is_empty());
        assert!(rel(&r, "b").blocks.is_empty());
        assert_eq!(rel(&r, "b").blocked_by, vec!["a".to_string()]);
    }

    #[test]
    fn blocking_relations_chain_no_transitive() {
        // a → b → c: a 直接 blocks b（不传递到 c）
        let edges = vec![
            edge("b", &["a"], UnlockRule::All),
            edge("c", &["b"], UnlockRule::All),
        ];
        let r = compute_blocking_relations(&edges);
        assert_eq!(rel(&r, "a").blocks, vec!["b".to_string()]);
        assert_eq!(rel(&r, "b").blocks, vec!["c".to_string()]);
        assert!(rel(&r, "c").blocks.is_empty());
        // 关键: a 不直接 blocks c
        assert!(!rel(&r, "a").blocks.contains(&"c".to_string()));
    }

    #[test]
    fn blocking_relations_fan_in() {
        // b 和 c 都依赖 a → a.blocks=[b, c]
        let edges = vec![
            edge("b", &["a"], UnlockRule::All),
            edge("c", &["a"], UnlockRule::All),
        ];
        let r = compute_blocking_relations(&edges);
        let mut blocks = rel(&r, "a").blocks.clone();
        blocks.sort();
        assert_eq!(blocks, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn blocking_relations_fan_out() {
        // c 依赖 [a, b]: c.blocked_by=[a, b]; a/b.blocks=[c]
        let edges = vec![Edge {
            to: "c".to_string(),
            prerequisites: ids(&["a", "b"]),
            rule: UnlockRule::All,
            ..Default::default()
        }];
        let r = compute_blocking_relations(&edges);
        let mut blocked = rel(&r, "c").blocked_by.clone();
        blocked.sort();
        assert_eq!(blocked, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(rel(&r, "a").blocks, vec!["c".to_string()]);
        assert_eq!(rel(&r, "b").blocks, vec!["c".to_string()]);
    }

    #[test]
    fn blocking_relations_dedup() {
        // 两条边都指向同一个 c,前置都是 a —— 去重
        let edges = vec![
            Edge {
                to: "c".to_string(),
                prerequisites: ids(&["a"]),
                rule: UnlockRule::All,
                ..Default::default()
            },
            Edge {
                to: "c".to_string(),
                prerequisites: ids(&["a"]),
                rule: UnlockRule::All,
                ..Default::default()
            },
        ];
        let r = compute_blocking_relations(&edges);
        assert_eq!(rel(&r, "a").blocks, vec!["c".to_string()]);
        assert_eq!(rel(&r, "c").blocked_by, vec!["a".to_string()]);
    }

    #[test]
    fn blocking_relations_exclude_does_not_link() {
        // exclude 是谓词改写,不在正向引用里 —— x 不会出现在 map 里
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            specs: None,
            excludes: Some(vec![PrereqSpec::Exclude {
                trigger: "x".to_string(),
                target: "a".to_string(),
                effect: ExcludeEffect::Disqualifies,
            }]),
            ..Default::default()
        }];
        let r = compute_blocking_relations(&edges);
        assert!(r.contains_key("a"), "a 是 t 的前置,进入 map");
        assert!(r.contains_key("t"));
        assert!(!r.contains_key("x"), "exclude 的 trigger 不进入正向引用图");
    }

    #[test]
    fn blocking_relations_specs_simple_group_count() {
        // specs 含 simple / group / count,各自成员都参与正向引用
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: vec![],
            rule: UnlockRule::All,
            groups: None,
            specs: Some(vec![
                PrereqSpec::Simple { id: "a".to_string(), count: None },
                PrereqSpec::Group {
                    members: vec![GroupMember::Id("b".to_string()), GroupMember::Id("c".to_string())],
                    pick: Some(1),
                },
                PrereqSpec::Count {
                    members: vec!["d".to_string(), "e".to_string()],
                    need: 2,
                },
            ]),
            excludes: None,
            ..Default::default()
        }];
        let r = compute_blocking_relations(&edges);
        let mut blocked = rel(&r, "t").blocked_by.clone();
        blocked.sort();
        assert_eq!(blocked, vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string(), "e".to_string()]);
        for id in ["a", "b", "c", "d", "e"] {
            assert_eq!(rel(&r, id).blocks, vec!["t".to_string()]);
        }
    }

    #[test]
    fn blocking_relations_prereq_plus_specs_dedup() {
        // 同一 id 既在 prerequisites 也在 specs.simple —— 去重
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a", "b"]),
            rule: UnlockRule::All,
            specs: Some(vec![
                PrereqSpec::Simple { id: "a".to_string(), count: None },
                PrereqSpec::Simple { id: "c".to_string(), count: None },
            ]),
            excludes: None,
            ..Default::default()
        }];
        let r = compute_blocking_relations(&edges);
        let mut blocked = rel(&r, "t").blocked_by.clone();
        blocked.sort();
        assert_eq!(blocked, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }
}
