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

/// 单个 spec 是否『满足』（exclude 在此永真，由谓词改写处理）。
fn is_spec_satisfied(spec: &PrereqSpec, done: &HashMap<String, bool>) -> bool {
    match spec {
        PrereqSpec::Simple { id } => done.get(id).copied().unwrap_or(false),
        PrereqSpec::Group { members, pick } => {
            let need = pick.unwrap_or(1);
            let hit = members
                .iter()
                .filter(|m| done.get(*m).copied().unwrap_or(false))
                .count() as u32;
            hit >= need
        }
        PrereqSpec::Count { members, need } => {
            let hit = members
                .iter()
                .filter(|m| done.get(*m).copied().unwrap_or(false))
                .count() as u32;
            hit >= *need
        }
        PrereqSpec::Exclude { .. } => true, // exclude 不参与正向 AND；谓词已改写
    }
}

/// 给定条目 id 列表 + 关系 + 完成 map，计算每个条目是否解锁。
pub fn compute_unlocked(
    ids: &[String],
    edges: &[Edge],
    done: &HashMap<String, bool>,
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
    fn unlocked_of(
        id: &str,
        unlocked: &mut HashMap<String, bool>,
        cycle_nodes: &HashSet<String>,
        edge_by_to: &HashMap<String, Edge>,
        done: &HashMap<String, bool>,
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
                let ok = specs.iter().all(|s| is_spec_satisfied(s, done));
                unlocked.insert(id.to_string(), ok);
                return ok;
            }
        }
        let done_count = edge
            .prerequisites
            .iter()
            .filter(|p| done.get(*p).copied().unwrap_or(false))
            .count();
        let ok = match &edge.groups {
            // 二选一组合语义：必选项全部 done 且 每个组至少一个 done
            Some(groups) if !groups.is_empty() => {
                let in_group: HashSet<&String> = groups.iter().flatten().collect();
                let mandatory_ok = edge
                    .prerequisites
                    .iter()
                    .filter(|p| !in_group.contains(p))
                    .all(|p| done.get(p).copied().unwrap_or(false));
                let groups_ok = groups
                    .iter()
                    .all(|g| g.iter().any(|p| done.get(p).copied().unwrap_or(false)));
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
        unlocked_of(id, &mut unlocked, &cycle_nodes, &edge_by_to, done);
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
        let r = compute_unlocked(&ids(&["a"]), &[], &done_map(&[]));
        assert_eq!(r.unlocked.get("a"), Some(&true));
    }

    #[test]
    fn rule_all_requires_all_done() {
        let edges = vec![edge("c", &["a", "b"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b", "c"]), &edges, &done_map(&["a"]));
        assert_eq!(r.unlocked.get("a"), Some(&true));
        assert_eq!(r.unlocked.get("b"), Some(&true));
        assert_eq!(r.unlocked.get("c"), Some(&false));

        let r2 = compute_unlocked(&ids(&["a", "b", "c"]), &edges, &done_map(&["a", "b"]));
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
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["a", "b"]));
        assert_eq!(r.unlocked.get("target"), Some(&true));

        let r2 = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["a"]));
        assert_eq!(r2.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn not_done_does_not_count() {
        // done map 中没有的条目视为未完成
        let edges = vec![edge("target", &["a", "b", "c"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&[]));
        assert_eq!(r.unlocked.get("target"), Some(&false));
    }

    #[test]
    fn cycle_items_are_blocked_and_reported() {
        let edges = vec![edge("a", &["b"], UnlockRule::All), edge("b", &["a"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "b"]), &edges, &done_map(&[]));
        assert_eq!(r.unlocked.get("a"), Some(&false));
        assert_eq!(r.unlocked.get("b"), Some(&false));
        assert!(!r.cycles.is_empty(), "should report at least one cycle");
    }

    #[test]
    fn dangling_refs_are_silently_ignored() {
        let edges = vec![edge("target", &["a", "ghost"], UnlockRule::All)];
        let r = compute_unlocked(&ids(&["a", "target"]), &edges, &done_map(&["a"]));
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
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["a", "c"]));
        assert!(ok(&r));
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["b", "c"]));
        assert!(ok(&r));
        // 缺 c → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["a"]));
        assert!(!ok(&r));
        // 组内一个都没完成 → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "target"]), &edges, &done_map(&["c"]));
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
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "target"]), &edges, &done_map(&["a", "c"]));
        assert!(ok(&r));
        // 只满足第一组 → 锁
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "target"]), &edges, &done_map(&["a"]));
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
        let r = compute_unlocked(&ids(&["a", "b", "target"]), &edges, &done_map(&["a"]));
        assert!(!ok(&r));
        let r = compute_unlocked(&ids(&["a", "b", "target"]), &edges, &done_map(&["a", "b"]));
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
        let r = compute_unlocked(&ids(&["a", "target"]), &edges, &done_map(&["a"]));
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
        let r2 = compute_unlocked(&ids(&["a", "target"]), &edges2, &done_map(&[]));
        assert_eq!(r2.unlocked.get("target"), Some(&false));
    }

    // ========== v2 specs / excludes ==========

    fn rewrite_done(raw: &HashMap<String, bool>, excludes: &[PrereqSpec]) -> HashMap<String, bool> {
        let mut m = raw.clone();
        for ex in excludes {
            if let PrereqSpec::Exclude { trigger, target, effect } = ex {
                if matches!(m.get(trigger).copied(), Some(true)) {
                    match effect {
                        ExcludeEffect::Disqualifies => {
                            m.insert(target.clone(), false);
                        }
                        ExcludeEffect::Satisfies => {
                            m.insert(target.clone(), true);
                        }
                    }
                }
            }
        }
        m
    }

    #[test]
    fn specs_simple_satisfied_when_id_done() {
        let edges = vec![Edge {
            to: "t".to_string(),
            prerequisites: ids(&["a"]),
            rule: UnlockRule::All,
            threshold: None,
            groups: None,
            specs: Some(vec![PrereqSpec::Simple { id: "a".to_string() }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "t"]), &edges, &done_map(&["a"]));
        assert_eq!(r.unlocked.get("t"), Some(&true));
        let r = compute_unlocked(&ids(&["a", "t"]), &edges, &done_map(&[]));
        assert_eq!(r.unlocked.get("t"), Some(&false));
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
                members: ids(&["a", "b", "c", "d"]),
                pick: Some(2),
            }]),
            excludes: None,
        }];
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "t"]), &edges, &done_map(&["a"]));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "c", "d", "t"]), &edges, &done_map(&["a", "b"]));
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
        let r = compute_unlocked(&ids(&["a", "b", "c", "t"]), &edges, &done_map(&["a"]));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "c", "t"]), &edges, &done_map(&["a", "b"]));
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
        let done = rewrite_done(&done_map(&["namedAward"]), &excludes);
        let r = compute_unlocked(
            &ids(&["chiefAward", "namedAward", "mainAward"]),
            &edges,
            &done,
        );
        assert_eq!(r.unlocked.get("mainAward"), Some(&true));
        // 拿到所长 → namedAward 被 disqualify → 锁
        let done = rewrite_done(&done_map(&["chiefAward", "namedAward"]), &excludes);
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
        let done = rewrite_done(&done_map(&["A"]), &excludes);
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
        let r = compute_unlocked(&ids(&["a", "b", "t"]), &edges, &done_map(&["a"]));
        assert_eq!(r.unlocked.get("t"), Some(&false));
        let r = compute_unlocked(&ids(&["a", "b", "t"]), &edges, &done_map(&["a", "b"]));
        assert_eq!(r.unlocked.get("t"), Some(&true));
    }
}
