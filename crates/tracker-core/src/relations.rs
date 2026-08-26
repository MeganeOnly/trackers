//! relations.json 读写 + 边容错纠正。
//!
//! 领域无关：前置依赖图对两个 app 语义完全一致，直接从 book-tracker 抽取。

use std::path::Path;

use crate::types::{Edge, RelationsFile, UnlockRule};

const EMPTY: RelationsFile = RelationsFile {
    version: 1,
    edges: Vec::new(),
};

/// 读 `<data_dir>/relations.json`。文件不存在 → 空 RelationsFile。
pub fn read_relations(data_dir: impl AsRef<Path>) -> std::io::Result<RelationsFile> {
    let path = data_dir.as_ref().join("relations.json");
    let raw: RelationsFile = crate::files::read_json(&path, EMPTY.clone())?;
    Ok(RelationsFile {
        version: if raw.version == 0 { 1 } else { raw.version },
        edges: raw.edges.into_iter().map(normalize_edge).collect(),
    })
}

/// 原子写整个 relations 文件。
/// `validate` 可选，返回 `Some(msg)` 时中止写入并抛错。
pub fn write_relations(
    data_dir: impl AsRef<Path>,
    edges: &[Edge],
    validate: Option<&dyn Fn(&[Edge]) -> Option<String>>,
) -> std::io::Result<()> {
    if let Some(v) = validate {
        if let Some(msg) = v(edges) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("relations validation failed: {msg}"),
            ));
        }
    }
    let payload = RelationsFile {
        version: 1,
        edges: edges.to_vec(),
    };
    crate::files::write_json(data_dir.as_ref().join("relations.json"), &payload)
}

/// 把 raw Edge 容错纠正成合法 Edge。
///
/// 注意：用 `..raw` 保留未显式归一化的字段（`specs` / `excludes`），不要用
/// `..Default::default()`——后者会把这两个 Option 字段重置成 None，
/// 导致每次读 `relations.json` 时丢掉 v2 specs 与互斥规则。
fn normalize_edge(raw: Edge) -> Edge {
    let rule = if raw.rule == UnlockRule::AnyOf {
        UnlockRule::AnyOf
    } else {
        UnlockRule::All
    };
    let prerequisites: Vec<String> = raw
        .prerequisites
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    let threshold = match (rule, raw.threshold) {
        (UnlockRule::AnyOf, Some(t)) if t >= 1 => Some(t.min(prerequisites.len() as u32)),
        _ => None,
    };
    // 二选一组合：过滤空成员与空组；全空 → None（回退到整组规则）
    let groups = raw.groups.map(|groups| {
        groups
            .into_iter()
            .map(|g| g.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>())
            .filter(|g| !g.is_empty())
            .collect::<Vec<_>>()
    });
    let groups = groups.filter(|g| !g.is_empty());
    Edge {
        prerequisites,
        rule,
        threshold,
        groups,
        ..raw
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn empty_edge(to: &str, prereqs: &[&str], rule: UnlockRule) -> Edge {
        Edge {
            to: to.to_string(),
            prerequisites: prereqs.iter().map(|s| s.to_string()).collect(),
            rule,
            ..Default::default()
        }
    }

    #[test]
    fn missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let r = read_relations(dir.path()).unwrap();
        assert_eq!(r.version, 1);
        assert!(r.edges.is_empty());
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let edges = vec![
            empty_edge("c", &["a", "b"], UnlockRule::All),
            empty_edge("d", &["a", "b", "c"], UnlockRule::AnyOf),
        ];
        write_relations(dir.path(), &edges, None).unwrap();
        let r = read_relations(dir.path()).unwrap();
        assert_eq!(r.edges.len(), 2);
        assert_eq!(r.edges[0].to, "c");
        assert_eq!(r.edges[0].rule, UnlockRule::All);
        assert_eq!(r.edges[1].to, "d");
        assert_eq!(r.edges[1].rule, UnlockRule::AnyOf);
    }

    #[test]
    fn threshold_clamped_to_prereq_count() {
        let dir = tempdir().unwrap();
        // threshold=10, prereqs=2 → 应被 clamp 到 2
        let raw = r#"{"version":1,"edges":[{"to":"x","prerequisites":["a","b"],"rule":"any_of","threshold":10}]}"#;
        std::fs::write(dir.path().join("relations.json"), raw).unwrap();
        let r = read_relations(dir.path()).unwrap();
        assert_eq!(r.edges[0].threshold, Some(2));
    }

    #[test]
    fn rule_all_drops_threshold() {
        let dir = tempdir().unwrap();
        let raw = r#"{"version":1,"edges":[{"to":"x","prerequisites":["a","b"],"rule":"all","threshold":5}]}"#;
        std::fs::write(dir.path().join("relations.json"), raw).unwrap();
        let r = read_relations(dir.path()).unwrap();
        assert!(r.edges[0].threshold.is_none());
    }

    #[test]
    fn validate_fn_blocks_write() {
        let dir = tempdir().unwrap();
        let edges = vec![empty_edge("x", &["y"], UnlockRule::All)];
        let validate = |e: &[Edge]| -> Option<String> {
            if e.iter().any(|x| x.to == "x") {
                Some("forbidden".into())
            } else {
                None
            }
        };
        let res = write_relations(dir.path(), &edges, Some(&validate));
        assert!(res.is_err());
        assert!(!dir.path().join("relations.json").exists());
    }

    #[test]
    fn groups_round_trip_and_empty_groups_dropped() {
        let dir = tempdir().unwrap();
        let edges = vec![Edge {
            to: "target".to_string(),
            prerequisites: vec!["a".into(), "b".into(), "c".into()],
            rule: UnlockRule::All,
            groups: Some(vec![vec!["a".into(), "b".into()]]),
            ..Default::default()
        }];
        write_relations(dir.path(), &edges, None).unwrap();
        let r = read_relations(dir.path()).unwrap();
        assert_eq!(r.edges[0].groups.as_ref().unwrap().len(), 1);
        assert_eq!(r.edges[0].groups.as_ref().unwrap()[0], vec!["a".to_string(), "b".to_string()]);

        // 空字符串成员被过滤；全空组被丢弃 → groups 变 None
        let raw = r#"{"version":1,"edges":[{"to":"x","prerequisites":["a"],"rule":"all","groups":[["",""]]}]}"#;
        std::fs::write(dir.path().join("relations.json"), raw).unwrap();
        let r2 = read_relations(dir.path()).unwrap();
        assert!(r2.edges[0].groups.is_none());
    }

    #[test]
    fn normalize_preserves_specs_and_excludes() {
        // 关键回归测试：normalize_edge 不能把 specs / excludes 字段 reset 成 None。
        // 历史上用 `..Default::default()` 导致每次读 relations.json 时丢掉 v2 字段，
        // 用户重启后 simple spec（含 count）+ exclude 规则全部消失，
        // 表现为"加了前置/互斥规则但读不到 / 像被删除了一样"。
        let raw = r#"{
            "version": 1,
            "edges": [{
                "to": "award",
                "prerequisites": ["paper"],
                "rule": "all",
                "specs": [{"kind":"simple","id":"paper","count":2}],
                "excludes": [{"kind":"exclude","trigger":"a","target":"paper","effect":"disqualifies"}]
            }]
        }"#;
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("relations.json"), raw).unwrap();
        let r = read_relations(dir.path()).unwrap();
        let specs = r.edges[0].specs.as_ref().expect("specs preserved");
        assert_eq!(specs.len(), 1);
        match &specs[0] {
            crate::types::PrereqSpec::Simple { id, count } => {
                assert_eq!(id, "paper");
                assert_eq!(*count, Some(2));
            }
            other => panic!("expected Simple spec, got {other:?}"),
        }
        let excludes = r.edges[0].excludes.as_ref().expect("excludes preserved");
        assert_eq!(excludes.len(), 1);
        assert!(matches!(
            &excludes[0],
            crate::types::PrereqSpec::Exclude { .. }
        ));
    }
}