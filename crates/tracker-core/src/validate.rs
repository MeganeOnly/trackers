//! relations 不变量校验 —— 检测 `compute_unlocked` 隐式依赖的不变量是否被破坏。
//!
//! # 为什么需要
//!
//! `unlock::compute_unlocked` 用 `edge_by_to.insert(e.to, ...)`（TS 端 `edgeByTo.set`）
//! 把边索引成 `to → Edge`。同一个 `to` 出现多条边时**后者静默覆盖前者**，
//! 前者的全部前置条件消失 —— 不报错、不警告、不留痕。
//!
//! 该不变量目前只由 UI 保证（`PrereqEditor` 保存时 `filter(e.to !== id)` + push 的
//! upsert 语义），内核本身不校验。可能破坏它的入口：
//!
//! - 用户手工编辑 `relations.json`（本地文件应用的常态）
//! - 未来的批量导入 / 数据迁移脚本
//! - 任何新增的写入路径
//!
//! 同类「静默丢前置」事故已经发生过一次：`relations::normalize_edge` 曾用
//! `..Default::default()` 把 `specs` / `excludes` 清成 `None`，症状是「加了前置或
//! 互斥规则但读不到，像被删除了一样」（见 `relations` 模块的回归测试）。
//!
//! # 定位
//!
//! 本模块只**报告**问题，不修改数据、不阻止读写 —— 调用方决定如何呈现。
//! 要收紧成硬拒绝，把返回的 issues 转成 `relations::write_relations` 的
//! `validate` 闭包所要的 `Some(msg)` 即可，无需改本模块。

use std::collections::HashMap;

use crate::types::Edge;
use crate::unlock::detect_cycles;

/// 违规代码：同一个 `to` 存在多条前置边。
pub const CODE_DUPLICATE_TO: &str = "duplicate_to";

/// 违规代码：关系图中存在循环依赖（环上节点全部锁死）。
pub const CODE_CYCLE: &str = "cycle";

/// 一条不变量违规。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeIssue {
    /// 机器可读代码，见 `CODE_*` 常量（便于调用方分流，不依赖文案）。
    pub code: &'static str,
    /// 涉及的 `edge.to`（环检测场景下取环的第一个节点）。
    pub to: String,
    /// 人读说明（中文，可直接展示给用户）。
    pub message: String,
    /// 仅 `code == CODE_CYCLE` 时存在：环的完整路径（首尾相同，例如 `["a","b","c","a"]`）。
    /// 非环问题此字段为 `None`。
    pub cycle: Option<Vec<String>>,
}

/// 校验 edges 的不变量，返回全部违规（空 `Vec` = 无问题）。
///
/// 当前检查：
/// - **`to` 唯一性**：重复 `to` 会让 `compute_unlocked` 静默覆盖（详见模块顶部注释）。
/// - **环检测**：`compute_unlocked` 已自带环检测并把环上节点置 false；本函数也独立报一份，
///   让"关系图是否健康"这个事实有单一通道输出，便于 UI / 日志 / 后端 write 时统一处理。
///
/// 输出顺序：`duplicate_to` 在前（按首次出现顺序），`cycle` 在后（按 `detect_cycles` 报告顺序）。
pub fn validate_edges(edges: &[Edge]) -> Vec<EdgeIssue> {
    let mut issues = Vec::new();

    // 1) duplicate_to：单独记首次出现顺序，HashMap 迭代顺序不确定
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut order: Vec<&str> = Vec::new();
    for e in edges {
        let n = counts.entry(e.to.as_str()).or_insert(0);
        if *n == 0 {
            order.push(e.to.as_str());
        }
        *n += 1;
    }
    for to in order {
        let n = counts[to];
        if n > 1 {
            issues.push(EdgeIssue {
                code: CODE_DUPLICATE_TO,
                to: to.to_string(),
                message: format!(
                    "目标 {to} 有 {n} 条前置边；解锁计算只会采用最后一条，另外 {} 条的前置条件会被静默丢弃",
                    n - 1
                ),
                cycle: None,
            });
        }
    }

    // 2) cycle：复用 unlock::detect_cycles（同一份实现，避免重复 DFS）
    for cycle in detect_cycles(edges) {
        let head = cycle.first().cloned().unwrap_or_default();
        let path = cycle.join(" → ");
        issues.push(EdgeIssue {
            code: CODE_CYCLE,
            to: head,
            message: format!("存在循环依赖: {path}"),
            cycle: Some(cycle),
        });
    }

    issues
}

/// 把违规列表格式化成单行摘要（用于日志 / 警告条）。无违规返回 `None`。
///
/// 最多列出前 3 条明细，其余折叠成计数，避免日志被超长行淹没。
pub fn format_issues(issues: &[EdgeIssue]) -> Option<String> {
    if issues.is_empty() {
        return None;
    }
    let shown: Vec<String> = issues.iter().take(3).map(|i| i.message.clone()).collect();
    let mut s = format!("relations 存在 {} 处不变量问题: {}", issues.len(), shown.join("; "));
    if issues.len() > shown.len() {
        s.push_str(&format!("（另有 {} 处未列出）", issues.len() - shown.len()));
    }
    Some(s)
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::UnlockRule;

    fn edge(to: &str, prereqs: &[&str]) -> Edge {
        Edge {
            to: to.to_string(),
            prerequisites: prereqs.iter().map(|s| s.to_string()).collect(),
            rule: UnlockRule::All,
            ..Default::default()
        }
    }

    #[test]
    fn empty_edges_have_no_issues() {
        assert!(validate_edges(&[]).is_empty());
    }

    #[test]
    fn unique_to_has_no_issues() {
        let edges = vec![edge("a", &["x"]), edge("b", &["y"]), edge("c", &["z"])];
        assert!(validate_edges(&edges).is_empty());
    }

    #[test]
    fn duplicate_to_is_reported_once_with_count() {
        let edges = vec![edge("a", &["x"]), edge("a", &["y"]), edge("b", &["z"])];
        let issues = validate_edges(&edges);
        assert_eq!(issues.len(), 1, "同一个 to 只报一条 issue");
        assert_eq!(issues[0].code, CODE_DUPLICATE_TO);
        assert_eq!(issues[0].to, "a");
        // 文案里要带上"2 条边"与"1 条被丢弃"，便于用户判断严重性
        assert!(issues[0].message.contains('2'), "got: {}", issues[0].message);
    }

    #[test]
    fn multiple_duplicates_reported_in_first_seen_order() {
        // b 先出现重复，a 后出现重复 —— 输出必须按首次出现顺序（b 在 a 前）
        let edges = vec![
            edge("b", &["1"]),
            edge("a", &["2"]),
            edge("b", &["3"]),
            edge("a", &["4"]),
        ];
        let issues = validate_edges(&edges);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].to, "b");
        assert_eq!(issues[1].to, "a");
    }

    #[test]
    fn triple_duplicate_counts_two_dropped() {
        let edges = vec![edge("a", &["x"]), edge("a", &["y"]), edge("a", &["z"])];
        let issues = validate_edges(&edges);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains('3'), "got: {}", issues[0].message);
    }

    #[test]
    fn format_issues_none_when_clean() {
        assert!(format_issues(&[]).is_none());
    }

    #[test]
    fn format_issues_folds_beyond_three() {
        let edges: Vec<Edge> = ["a", "b", "c", "d"]
            .iter()
            .flat_map(|t| vec![edge(t, &["x"]), edge(t, &["y"])])
            .collect();
        let issues = validate_edges(&edges);
        assert_eq!(issues.len(), 4);
        let msg = format_issues(&issues).expect("should summarize");
        assert!(msg.contains("4 处"), "got: {msg}");
        assert!(msg.contains("另有 1 处未列出"), "got: {msg}");
    }

    /// 回归锚点：把校验函数与它要防的实际行为绑在一起。
    /// 若哪天 `compute_unlocked` 改成合并同 `to` 的多条边，本测试会失败，
    /// 提示同步放宽 / 删除 `duplicate_to` 检查。
    #[test]
    fn duplicate_to_really_drops_prerequisites_in_compute_unlocked() {
        use crate::unlock::compute_unlocked;

        // 两条同 to 的边：第一条要 x，第二条要 y。只有 x 完成。
        let edges = vec![edge("t", &["x"]), edge("t", &["y"])];
        let ids: Vec<String> = ["x", "y", "t"].iter().map(|s| s.to_string()).collect();
        let is_done = |id: &str, _k: u32| id == "x";

        let r = compute_unlocked(&ids, &edges, &is_done);
        // 后一条边（要 y）覆盖前一条（要 x）→ y 未完成 → t 锁住。
        // 第一条边"要 x 且 x 已完成"这个事实被完全丢弃。
        assert_eq!(
            r.unlocked.get("t"),
            Some(&false),
            "确认覆盖行为存在，这正是 validate_edges 要报告的隐患"
        );
        assert_eq!(validate_edges(&edges).len(), 1, "该数据应被校验捕获");
    }

    // ========== cycle 检测 ==========

    #[test]
    fn cycle_acyclic_reports_none() {
        let edges = vec![edge("b", &["a"])];
        let issues: Vec<_> = validate_edges(&edges)
            .into_iter()
            .filter(|i| i.code == CODE_CYCLE)
            .collect();
        assert!(issues.is_empty(), "无环时不报 cycle");
    }

    #[test]
    fn cycle_two_node_reported() {
        let edges = vec![edge("a", &["b"]), edge("b", &["a"])];
        let issues: Vec<_> = validate_edges(&edges)
            .into_iter()
            .filter(|i| i.code == CODE_CYCLE)
            .collect();
        assert_eq!(issues.len(), 1, "只报一个 cycle");
        let issue = &issues[0];
        let cyc = issue.cycle.as_ref().expect("cycle 应填");
        assert_eq!(cyc.len(), 3, "环路径含首尾");
        assert_eq!(cyc[0], cyc[2], "首尾相同");
        // 集合恰为 {a, b}
        let unique: std::collections::BTreeSet<_> = cyc.iter().take(2).collect();
        assert_eq!(unique.len(), 2);
        assert!(issue.message.contains("循环依赖"));
        assert_eq!(issue.to, cyc[0], "to 字段 = 环首节点");
    }

    #[test]
    fn cycle_self_loop_reported() {
        let edges = vec![edge("a", &["a"])];
        let issues: Vec<_> = validate_edges(&edges)
            .into_iter()
            .filter(|i| i.code == CODE_CYCLE)
            .collect();
        assert_eq!(issues.len(), 1);
        let cyc = issues[0].cycle.as_ref().unwrap();
        assert_eq!(cyc, &vec!["a".to_string(), "a".to_string()]);
    }

    #[test]
    fn cycle_long_chain_reported() {
        let edges = vec![
            edge("b", &["a"]),
            edge("c", &["b"]),
            edge("a", &["c"]),
        ];
        let issues: Vec<_> = validate_edges(&edges)
            .into_iter()
            .filter(|i| i.code == CODE_CYCLE)
            .collect();
        assert_eq!(issues.len(), 1);
        let cyc = issues[0].cycle.as_ref().unwrap();
        assert_eq!(cyc.len(), 4, "a→b→c→a 共 4 个");
        assert_eq!(cyc[0], cyc[3]);
    }

    #[test]
    fn cycle_and_duplicate_to_ordering() {
        // 同一数据集同时有 duplicate_to 与 cycle —— 输出顺序: duplicate 先, cycle 后
        let edges = vec![
            edge("t", &["x"]),
            edge("t", &["y"]),
            edge("a", &["b"]),
            edge("b", &["a"]),
        ];
        let issues = validate_edges(&edges);
        let dup = issues.iter().position(|i| i.code == CODE_DUPLICATE_TO);
        let cyc = issues.iter().position(|i| i.code == CODE_CYCLE);
        assert!(dup.is_some() && cyc.is_some());
        assert!(dup.unwrap() < cyc.unwrap(), "duplicate 在 cycle 前");
    }

    #[test]
    fn format_issues_works_with_cycle() {
        let edges = vec![edge("a", &["b"]), edge("b", &["a"])];
        let msg = format_issues(&validate_edges(&edges));
        assert!(msg.is_some());
        assert!(msg.unwrap().contains("循环依赖"));
    }
}
