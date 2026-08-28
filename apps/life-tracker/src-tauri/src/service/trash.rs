//! 回收站 —— 删除目标时不真正删，而是移到 `<data_dir>/.trash/`。
//!
//! 目录布局：
//! ```text
//! <data_dir>/.trash/
//!   goals/         # 被删的 .md 文件,命名 `<goal_id>_<deleted_at_ms>.md`
//!   relations/     # 被删的 relations 片段(涉及该 goal 的 edges),命名同上 .json
//! ```
//!
//! 文件名约定 `<id>_<ms>` 保证同名 goal 多次删除可同时存在(不会互相覆盖)。
//! goal_id 由 `slug::make_base_id` 生成(数字字符串),不含 `_`,所以 rsplit_once('_')
//! 解析无歧义。
//!
//! 还原时跑 cycle 检测 —— 防止删/还原之间其他目标变化引入环;如校验失败,
//! 已经写回 `goals/<id>.md` 也会回滚。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use tracker_core::files::{atomic_write_file, ensure_dir};
use tracker_core::frontmatter::{format_iso8601_utc, split_frontmatter};
use tracker_core::relations as data_rel;
use tracker_core::types::{Edge, PrereqSpec};
use tracker_core::unlock::detect_cycles;

use crate::data::goals as data;
use crate::types::Goal;

// ============== 路径 helper ==============

pub fn trash_dir(data_dir: impl AsRef<Path>) -> PathBuf {
    data_dir.as_ref().join(".trash")
}
pub fn trash_goals_dir(data_dir: impl AsRef<Path>) -> PathBuf {
    trash_dir(data_dir).join("goals")
}
pub fn trash_relations_dir(data_dir: impl AsRef<Path>) -> PathBuf {
    trash_dir(data_dir).join("relations")
}

// ============== 公开类型 ==============

/// 回收站条目（UI 列表展示用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashEntry {
    pub goal_id: String,
    /// 删除时刻 unix 毫秒
    pub deleted_at: i64,
    /// ISO 8601 字符串（与 .md 里的 created/updated 形状一致）
    pub deleted_at_iso: String,
    pub title: String,
    pub category: String,
}

/// `.trash/relations/<id>_<ts>.json` 文件结构 —— 只存「涉及该 goal 的 edges」。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashRelationsPayload {
    pub goal_id: String,
    pub deleted_at: i64,
    pub edges: Vec<Edge>,
}

// ============== 内部工具 ==============

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn iso_from_ms(ms: i64) -> String {
    format_iso8601_utc((ms.max(0) / 1000) as u64)
}

/// 从 `.md` / `.json` 文件名解析 `(goal_id, deleted_at_ms)`。
/// 期望 `<goal_id>_<ms>.<ext>`；解析失败返回 `None`（让调用方静默跳过）。
fn parse_trash_filename(name: &str, suffix: &str) -> Option<(String, i64)> {
    let base = name.strip_suffix(suffix)?;
    let (id, ts) = base.rsplit_once('_')?;
    let ts: i64 = ts.parse().ok()?;
    Some((id.to_string(), ts))
}

/// 从 .md 原始内容容错解析 title / category（解析失败 → 空串）。
fn parse_goal_meta(raw: &str) -> (String, String) {
    let (data, _) = split_frontmatter(raw).unwrap_or((serde_json::json!({}), String::new()));
    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let category = data
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    (title, category)
}

/// 是否涉及指定 goal（作为 `to` / 前置 / spec 成员 / exclude 一端）。
pub fn involves_goal(edge: &Edge, goal_id: &str) -> bool {
    if edge.to == goal_id {
        return true;
    }
    if edge.prerequisites.iter().any(|p| p == goal_id) {
        return true;
    }
    if let Some(specs) = &edge.specs {
        for s in specs {
            match s {
                PrereqSpec::Simple { id, .. } if id == goal_id => return true,
                PrereqSpec::Group { members, .. }
                    if members.iter().any(|m| m.id() == goal_id) =>
                {
                    return true;
                }
                PrereqSpec::Count { members, .. } if members.iter().any(|m| m == goal_id) => {
                    return true;
                }
                PrereqSpec::Exclude { trigger, target, .. }
                    if trigger == goal_id || target == goal_id =>
                {
                    return true;
                }
                _ => {}
            }
        }
    }
    if let Some(excludes) = &edge.excludes {
        for x in excludes {
            if let PrereqSpec::Exclude { trigger, target, .. } = x {
                if trigger == goal_id || target == goal_id {
                    return true;
                }
            }
        }
    }
    false
}

// ============== 操作 ==============

/// 把一个目标移入回收站。
///
/// 流程（不严格原子 —— 任一步失败都可能留半截状态；建议外层在确认
/// `move_to_trash` 返回前不要视为"删除成功"）：
/// 1. `.md` 复制到 `.trash/goals/<id>_<ms>.md`
/// 2. `relations.json` 过滤出涉及该 goal 的 edges → `.trash/relations/<id>_<ms>.json`
///    剩余 edges 写回 `relations.json`
/// 3. 删 `goals/<id>.md`
///
/// 目标不存在 → 幂等 `Ok(())`（已经删过 / 没创建过都视为 OK）。
pub fn move_to_trash(data_dir: impl AsRef<Path>, goal_id: &str) -> std::io::Result<()> {
    let data_dir_str = data_dir.as_ref().to_string_lossy();
    let goals_dir = crate::data::config::paths::goals_dir(data_dir_str.as_ref());
    let md_src = goals_dir.join(format!("{goal_id}.md"));
    if !md_src.exists() {
        return Ok(());
    }

    let now = now_ms();
    ensure_dir(trash_goals_dir(data_dir.as_ref()))?;
    ensure_dir(trash_relations_dir(data_dir.as_ref()))?;

    // 1. 复制 .md 到 .trash/goals/
    let raw = std::fs::read_to_string(&md_src)?;
    let md_dst = trash_goals_dir(data_dir.as_ref()).join(format!("{goal_id}_{now}.md"));
    atomic_write_file(&md_dst, &raw)?;

    // 2. 过滤 relations
    let rel_file = data_rel::read_relations(data_dir.as_ref())?;
    let (involved, others): (Vec<Edge>, Vec<Edge>) = rel_file
        .edges
        .into_iter()
        .partition(|e| involves_goal(e, goal_id));

    if !involved.is_empty() {
        let payload = TrashRelationsPayload {
            goal_id: goal_id.to_string(),
            deleted_at: now,
            edges: involved,
        };
        let json = serde_json::to_string_pretty(&payload).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
        let rel_dst = trash_relations_dir(data_dir.as_ref())
            .join(format!("{goal_id}_{now}.json"));
        atomic_write_file(&rel_dst, &format!("{json}\n"))?;
    }

    // 3. 重写 relations.json（保留余下 edges；不传 validate——删目标不该被 cycle 卡住）
    data_rel::write_relations(data_dir.as_ref(), &others, None)?;

    // 4. 删原 .md
    std::fs::remove_file(&md_src)?;
    Ok(())
}

/// 列出所有回收站条目，按删除时间倒序（最新在前）。
pub fn list_trash(data_dir: impl AsRef<Path>) -> std::io::Result<Vec<TrashEntry>> {
    let dir = trash_goals_dir(data_dir.as_ref());
    ensure_dir(trash_dir(data_dir.as_ref()))?;
    ensure_dir(&dir)?;

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.ends_with(".md") {
            continue;
        }
        let Some((id, ts)) = parse_trash_filename(name, ".md") else {
            continue;
        };
        let raw = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let (title, category) = parse_goal_meta(&raw);
        entries.push(TrashEntry {
            goal_id: id,
            deleted_at: ts,
            deleted_at_iso: iso_from_ms(ts),
            title,
            category,
        });
    }
    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(entries)
}

/// 从回收站还原一个目标到 `goals/<id>.md` + 把对应 edges 合并回 relations.json。
///
/// 流程：
/// 1. 读 `.trash/goals/<id>_<ts>.md` → 写到 `goals/<id>.md`
/// 2. 如有 `.trash/relations/<id>_<ts>.json`：读 edges，合并到现有 relations.json
///    （同 `to` 的边去重，保留先出现的）
/// 3. 跑 cycle 检测 —— 如失败回滚 `goals/<id>.md` 并返回错误
/// 4. 写回 relations.json，删 `.trash/` 下两个文件
/// 5. 读回 Goal 返回给 UI
///
/// 找不到对应条目 → `Err(NotFound)`。
pub fn restore_from_trash(data_dir: impl AsRef<Path>, goal_id: &str, ts: i64) -> std::io::Result<Goal> {
    let trash_g = trash_goals_dir(data_dir.as_ref()).join(format!("{goal_id}_{ts}.md"));
    let trash_r = trash_relations_dir(data_dir.as_ref()).join(format!("{goal_id}_{ts}.json"));

    if !trash_g.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("trash entry not found: {goal_id} @ {ts}"),
        ));
    }

    // 1. 写回 .md
    let raw = std::fs::read_to_string(&trash_g)?;
    let data_dir_str = data_dir.as_ref().to_string_lossy();
    let goals_dir = crate::data::config::paths::goals_dir(data_dir_str.as_ref());
    ensure_dir(&goals_dir)?;
    let dst = goals_dir.join(format!("{goal_id}.md"));
    atomic_write_file(&dst, &raw)?;

    // 2. 合并 edges
    let mut edges = data_rel::read_relations(data_dir.as_ref())?.edges;
    let mut merged_relations = false;
    if trash_r.exists() {
        let raw = std::fs::read_to_string(&trash_r)?;
        let payload: TrashRelationsPayload = serde_json::from_str(&raw)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        edges.extend(payload.edges);
        merged_relations = true;
    }
    // 同 to 去重（保第一个出现的——已存在的更权威）
    if merged_relations {
        let mut seen = std::collections::HashSet::new();
        edges.retain(|e| seen.insert(e.to.clone()));
    }

    // 3. cycle 检测（破坏时回滚 .md）
    let cycles = detect_cycles(&edges);
    if !cycles.is_empty() {
        let _ = std::fs::remove_file(&dst);
        let msg = format!(
            "恢复后会引入循环依赖: {}",
            cycles
                .iter()
                .take(3)
                .map(|c| format!("[{}]", c.join(" → ")))
                .collect::<Vec<_>>()
                .join(", ")
        );
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg));
    }

    // 4. 写回 relations.json
    data_rel::write_relations(data_dir.as_ref(), &edges, None)?;

    // 5. 清 trash
    let _ = std::fs::remove_file(&trash_g);
    let _ = std::fs::remove_file(&trash_r);

    // 6. 读回 Goal
    let goal = data::read_goal(&goals_dir, goal_id)?.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("restored goal not found: {goal_id}"),
        )
    })?;
    Ok(goal)
}

/// 永久删除一个回收站条目（同时删除 goals 和 relations 两个文件）。
/// 不存在的文件静默忽略（幂等）。
pub fn purge_from_trash(data_dir: impl AsRef<Path>, goal_id: &str, ts: i64) -> std::io::Result<()> {
    let trash_g = trash_goals_dir(data_dir.as_ref()).join(format!("{goal_id}_{ts}.md"));
    let trash_r = trash_relations_dir(data_dir.as_ref()).join(format!("{goal_id}_{ts}.json"));
    let _ = std::fs::remove_file(&trash_g);
    let _ = std::fs::remove_file(&trash_r);
    Ok(())
}

/// 清空回收站，返回删除的文件总数（goals + relations）。
pub fn empty_trash(data_dir: impl AsRef<Path>) -> std::io::Result<usize> {
    let dir = trash_dir(data_dir.as_ref());
    ensure_dir(&dir)?;
    let mut count = 0;
    for sub in ["goals", "relations"] {
        let sub_dir = dir.join(sub);
        if !sub_dir.exists() {
            continue;
        }
        for entry in std::fs::read_dir(&sub_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                std::fs::remove_file(entry.path())?;
                count += 1;
            }
        }
    }
    Ok(count)
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{GoalInput, GoalStatus, Progress};
    use std::collections::HashSet;
    use tracker_core::types::UnlockRule;

    fn temp_data_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("goals")).unwrap();
        dir
    }

    fn sample_input(title: &str) -> GoalInput {
        GoalInput {
            title: title.to_string(),
            note: String::new(),
            category: "学业".to_string(),
            deadline: None,
            status: GoalStatus::InProgress,
            progress: Some(Progress { current: 0, total: Some(1) }),
            countable: false,
            pinned: false,
            hidden: false,
            collapsed: false,
        }
    }

    fn write_goal_in(dir: &Path, title: &str) -> String {
        // 每次重新读 ids —— 复用同一个 empty HashSet 会让 make_base_id
        // 把所有 goal 都分配成 id="1"，后写的关系边变成自环。
        let ids: HashSet<String> = data::list_goal_ids(dir.join("goals"))
            .unwrap()
            .into_iter()
            .collect();
        let g = data::write_goal(dir.join("goals"), &sample_input(title), &ids).unwrap();
        g.id
    }

    fn edge_all(to: &str, prereqs: &[&str]) -> Edge {
        Edge {
            to: to.to_string(),
            prerequisites: prereqs.iter().map(|s| s.to_string()).collect(),
            rule: UnlockRule::All,
            ..Default::default()
        }
    }

    #[test]
    fn move_to_trash_removes_md_and_keeps_relations() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "A");
        let b = write_goal_in(dir.path(), "B");
        let c = write_goal_in(dir.path(), "C");
        // A 是 B 和 C 的前置
        data_rel::write_relations(
            dir.path(),
            &[edge_all(&b, &[&a]), edge_all(&c, &[&a])],
            None,
        )
        .unwrap();

        move_to_trash(dir.path(), &a).unwrap();

        // goals/<a>.md 不存在
        assert!(!dir.path().join("goals").join(format!("{a}.md")).exists());
        // .trash/goals/<a>_<ts>.md 存在
        let trash_entries: Vec<_> = std::fs::read_dir(trash_goals_dir(dir.path()))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(trash_entries.len(), 1);
        // relations.json 中只剩 A 自己的边？应该没有——A 只作前置
        let rel = data_rel::read_relations(dir.path()).unwrap();
        assert!(rel.edges.is_empty(), "涉及 A 的边应全被移走");
        // .trash/relations/<a>_<ts>.json 含两条
        let trash_r_entries: Vec<_> = std::fs::read_dir(trash_relations_dir(dir.path()))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(trash_r_entries.len(), 1);
        let raw = std::fs::read_to_string(trash_r_entries[0].path()).unwrap();
        let payload: TrashRelationsPayload = serde_json::from_str(&raw).unwrap();
        assert_eq!(payload.edges.len(), 2);
    }

    #[test]
    fn move_to_trash_is_idempotent_on_missing() {
        let dir = temp_data_dir();
        // 目标不存在 → Ok(())，不报错
        move_to_trash(dir.path(), "nope").unwrap();
    }

    #[test]
    fn list_trash_returns_meta() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "国奖");
        let b = write_goal_in(dir.path(), "三好");
        move_to_trash(dir.path(), &a).unwrap();
        // 强制时间差（同一 goal_id 多次删除需要不同 ts；这里测两个不同 goal）
        std::thread::sleep(std::time::Duration::from_millis(5));
        move_to_trash(dir.path(), &b).unwrap();

        let entries = list_trash(dir.path()).unwrap();
        assert_eq!(entries.len(), 2);
        // 最新删除在前
        assert!(entries[0].deleted_at >= entries[1].deleted_at);
        // 找到标题
        let titles: Vec<_> = entries.iter().map(|e| e.title.as_str()).collect();
        assert!(titles.contains(&"国奖"));
        assert!(titles.contains(&"三好"));
        // 分类读到了
        assert!(entries.iter().all(|e| e.category == "学业"));
    }

    #[test]
    fn restore_round_trip() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "A");
        let b = write_goal_in(dir.path(), "B");
        data_rel::write_relations(dir.path(), &[edge_all(&b, &[&a])], None).unwrap();

        move_to_trash(dir.path(), &a).unwrap();
        // 拿到条目 ts
        let entries = list_trash(dir.path()).unwrap();
        assert_eq!(entries.len(), 1);
        let ts = entries[0].deleted_at;

        // restore
        let restored = restore_from_trash(dir.path(), &a, ts).unwrap();
        assert_eq!(restored.title, "A");
        // goals/<a>.md 回来了
        assert!(dir.path().join("goals").join(format!("{a}.md")).exists());
        // relations.json 也回来了
        let rel = data_rel::read_relations(dir.path()).unwrap();
        assert_eq!(rel.edges.len(), 1);
        assert_eq!(rel.edges[0].to, b);
        // .trash 目录清空（两个文件都删了）
        let g_count = std::fs::read_dir(trash_goals_dir(dir.path())).unwrap().count();
        let r_count = std::fs::read_dir(trash_relations_dir(dir.path())).unwrap().count();
        assert_eq!(g_count, 0);
        assert_eq!(r_count, 0);
    }

    #[test]
    fn restore_rejects_when_creates_cycle() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "A");
        let b = write_goal_in(dir.path(), "B");
        // 当前 relations: B 依赖 A
        data_rel::write_relations(dir.path(), &[edge_all(&b, &[&a])], None).unwrap();

        // 删 A（A 是 B 的前置）
        move_to_trash(dir.path(), &a).unwrap();
        let entries = list_trash(dir.path()).unwrap();
        let ts = entries[0].deleted_at;

        // 这时加一条：A 依赖 B（手动写 relations 引入环）
        data_rel::write_relations(dir.path(), &[edge_all(&a, &[&b])], None).unwrap();

        // restore A：合并后变成 [B<-A, A<-B] —— cycle
        let err = restore_from_trash(dir.path(), &a, ts).unwrap_err();
        assert!(err.to_string().contains("循环"));
        // 回滚：A 没回到 goals
        assert!(!dir.path().join("goals").join(format!("{a}.md")).exists());
        // relations 仍是用户手动写的 A<-B
        let rel = data_rel::read_relations(dir.path()).unwrap();
        assert_eq!(rel.edges.len(), 1);
        assert_eq!(rel.edges[0].to, a);
    }

    #[test]
    fn purge_removes_both_files() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "A");
        move_to_trash(dir.path(), &a).unwrap();
        let entries = list_trash(dir.path()).unwrap();
        let ts = entries[0].deleted_at;

        purge_from_trash(dir.path(), &a, ts).unwrap();
        assert_eq!(std::fs::read_dir(trash_goals_dir(dir.path())).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(trash_relations_dir(dir.path())).unwrap().count(), 0);
    }

    #[test]
    fn empty_trash_clears_all() {
        let dir = temp_data_dir();
        let a = write_goal_in(dir.path(), "A");
        let b = write_goal_in(dir.path(), "B");
        move_to_trash(dir.path(), &a).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        move_to_trash(dir.path(), &b).unwrap();

        let n = empty_trash(dir.path()).unwrap();
        // 2 个 goals .md + 0 relations（A、B 都没被任何 edge 引用）
        assert!(n >= 2);
        assert_eq!(std::fs::read_dir(trash_goals_dir(dir.path())).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(trash_relations_dir(dir.path())).unwrap().count(), 0);
    }

    #[test]
    fn involves_goal_catches_all_references() {
        let e1 = edge_all("X", &["A", "B"]); // prereq
        assert!(involves_goal(&e1, "A"));
        assert!(involves_goal(&e1, "B"));
        assert!(involves_goal(&e1, "X")); // to
        assert!(!involves_goal(&e1, "C"));
    }
}
