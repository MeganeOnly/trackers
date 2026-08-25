//! goal.md 读写(frontmatter via 手写 JSON parser)。
//!
//! - 每个目标一个 `<id>.md`,frontmatter 是 JSON,正文是 Markdown
//! - `progress` / `deadline` 字段只在有值时写入,避免污染 frontmatter
//! - 损坏文件不阻塞其他目标加载,返回 broken 列表
//!
//! 通用工具（原子写 / 数字 ID / frontmatter 拆分 / ISO 时间戳 / 进度纯函数）
//! 来自 monorepo 共享内核 `tracker-core`。

use std::collections::HashSet;
use std::path::Path;

use tracker_core::files::{atomic_write_file, ensure_dir};
use tracker_core::frontmatter::{now_iso, split_frontmatter};
use tracker_core::progress::normalize_progress_input;
use tracker_core::slug::make_base_id;
use crate::types::{Goal, GoalInput, GoalPatch, GoalStatus};

fn is_valid_status(s: &str) -> bool {
    matches!(
        s,
        "not_started" | "in_progress" | "done" | "shelved" | "abandoned"
    )
}

/// 列出所有目标的 ID(从文件名读)。
pub fn list_goal_ids(goals_dir: impl AsRef<Path>) -> std::io::Result<Vec<String>> {
    ensure_dir(&goals_dir)?;
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(goals_dir.as_ref())? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.ends_with(".md") {
            ids.push(name.trim_end_matches(".md").to_string());
        }
    }
    Ok(ids)
}

/// 读取一个目标。文件不存在 → `Ok(None)`。
pub fn read_goal(goals_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Goal>> {
    let path = goals_dir.as_ref().join(format!("{id}.md"));
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let (data, _body) = split_frontmatter(&raw)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing frontmatter"))?;
    let status = data
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing status"))?;
    if !is_valid_status(status) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid status: {status}"),
        ));
    }
    Ok(Some(normalize_goal(id, &data)))
}

fn normalize_goal(id: &str, data: &serde_json::Value) -> Goal {
    Goal {
        id: id.to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        note: data.get("note").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        category: data.get("category").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        deadline: data.get("deadline").and_then(|v| v.as_str()).map(String::from),
        status: parse_status(data.get("status")),
        progress: data.get("progress").and_then(tracker_core::progress::parse_progress),
        created: data.get("created").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        updated: data.get("updated").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    }
}

fn parse_status(v: Option<&serde_json::Value>) -> GoalStatus {
    match v.and_then(|x| x.as_str()) {
        Some("in_progress") => GoalStatus::InProgress,
        Some("done") => GoalStatus::Done,
        Some("shelved") => GoalStatus::Shelved,
        Some("abandoned") => GoalStatus::Abandoned,
        _ => GoalStatus::NotStarted,
    }
}

/// 批量读所有目标,跳过损坏文件,返回损坏列表。
pub fn read_all_goals(goals_dir: impl AsRef<Path>) -> std::io::Result<GoalListResult> {
    let ids = list_goal_ids(&goals_dir)?;
    let mut goals = Vec::new();
    let mut broken = Vec::new();
    for id in ids {
        match read_goal(&goals_dir, &id) {
            Ok(Some(g)) => goals.push(g),
            Ok(None) => {}
            Err(e) => broken.push(BrokenEntry { id, error: e.to_string() }),
        }
    }
    Ok(GoalListResult { goals, broken })
}

#[derive(Debug, Clone)]
pub struct BrokenEntry {
    pub id: String,
    pub error: String,
}

/// `read_all_goals` 的返回结构(goals + broken 列表)。
#[derive(Debug, Clone)]
pub struct GoalListResult {
    pub goals: Vec<Goal>,
    pub broken: Vec<BrokenEntry>,
}

/// 写入一个目标(新建)。返回写入后的 Goal(含 id)。
pub fn write_goal(
    goals_dir: impl AsRef<Path>,
    input: &GoalInput,
    existing_ids: &HashSet<String>,
) -> std::io::Result<Goal> {
    let id = make_base_id(existing_ids.iter().map(String::as_str));
    let now = now_iso();
    let goal = Goal {
        id,
        title: input.title.clone(),
        note: input.note.clone(),
        category: input.category.clone(),
        deadline: input.deadline.clone(),
        status: input.status,
        progress: normalize_progress_input(input.progress.as_ref()),
        created: now.clone(),
        updated: now,
    };
    persist(&goals_dir, &goal)?;
    Ok(goal)
}

/// 更新一个目标,保留 created,刷新 updated。
pub fn update_goal(
    goals_dir: impl AsRef<Path>,
    id: &str,
    patch: &GoalPatch,
) -> std::io::Result<Goal> {
    let existing = read_goal(&goals_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("goal not found: {id}")))?;

    let mut merged = existing;
    if let Some(v) = &patch.title { merged.title = v.clone(); }
    if let Some(v) = &patch.note { merged.note = v.clone(); }
    if let Some(v) = &patch.category { merged.category = v.clone(); }
    if let Some(v) = &patch.deadline { merged.deadline = if v.is_empty() { None } else { Some(v.clone()) }; }
    if let Some(v) = patch.status { merged.status = v; }
    // progress 三态:
    // - patch.progress = None → 不改
    // - patch.progress = Some(None) → 清空
    // - patch.progress = Some(Some(p)) → 设为 p(用 normalize 规整)
    if let Some(prog_opt) = &patch.progress {
        merged.progress = match prog_opt {
            None => None,
            Some(p) => normalize_progress_input(Some(p)),
        };
    }
    merged.updated = now_iso();

    persist(&goals_dir, &merged)?;
    Ok(merged)
}

/// 快速调整 progress.current。目标不存在 → 抛错。
pub fn bump_progress(goals_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Goal> {
    let existing = read_goal(&goals_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("goal not found: {id}")))?;
    let next = tracker_core::progress::bump_progress(existing.progress.as_ref(), delta);
    let mut patch = GoalPatch::default();
    patch.progress = Some(Some(next));
    update_goal(&goals_dir, id, &patch)
}

/// 删除一个目标。
pub fn delete_goal(goals_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    let path = goals_dir.as_ref().join(format!("{id}.md"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn persist(goals_dir: impl AsRef<Path>, goal: &Goal) -> std::io::Result<()> {
    let body = format!("# {}\n\n## 备注\n", goal.title);
    // 构造 frontmatter (serde_json::Map)
    let mut fm = serde_json::Map::new();
    fm.insert("id".into(), serde_json::Value::String(goal.id.clone()));
    fm.insert("title".into(), serde_json::Value::String(goal.title.clone()));
    fm.insert("note".into(), serde_json::Value::String(goal.note.clone()));
    fm.insert("category".into(), serde_json::Value::String(goal.category.clone()));
    if let Some(d) = &goal.deadline {
        fm.insert("deadline".into(), serde_json::Value::String(d.clone()));
    }
    fm.insert(
        "status".into(),
        serde_json::Value::String(goal.status.as_str().to_string()),
    );
    fm.insert("created".into(), serde_json::Value::String(goal.created.clone()));
    fm.insert("updated".into(), serde_json::Value::String(goal.updated.clone()));
    if let Some(p) = &goal.progress {
        let mut prog_map = serde_json::Map::new();
        prog_map.insert("current".into(), serde_json::Value::Number(p.current.into()));
        if let Some(t) = p.total {
            prog_map.insert("total".into(), serde_json::Value::Number(t.into()));
        }
        fm.insert("progress".into(), serde_json::Value::Object(prog_map));
    }

    let front = serde_json::to_string_pretty(&serde_json::Value::Object(fm))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let content = format!("---\n{front}\n---\n{body}");

    let path = goals_dir.as_ref().join(format!("{}.md", goal.id));
    atomic_write_file(&path, &content)
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Progress;

    fn temp_goals_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        ensure_dir(dir.path().join("goals")).unwrap();
        dir
    }

    fn sample_input() -> GoalInput {
        GoalInput {
            title: "拿国奖".to_string(),
            note: "前置:三好 + 两篇 SCI".to_string(),
            category: "学业".to_string(),
            deadline: Some("2027-06-30".to_string()),
            status: GoalStatus::InProgress,
            progress: Some(Progress { current: 1, total: Some(2) }),
        }
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        let goal = write_goal(&goals_dir, &sample_input(), &HashSet::new()).unwrap();
        assert_eq!(goal.id, "1");

        let read_back = read_goal(&goals_dir, "1").unwrap().unwrap();
        assert_eq!(read_back.title, "拿国奖");
        assert_eq!(read_back.category, "学业");
        assert_eq!(read_back.deadline.as_deref(), Some("2027-06-30"));
        assert_eq!(read_back.status, GoalStatus::InProgress);
        assert_eq!(read_back.progress.as_ref().unwrap().current, 1);
        assert_eq!(read_back.progress.as_ref().unwrap().total, Some(2));
        assert_eq!(read_back.created, read_back.updated);
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = temp_goals_dir();
        assert!(read_goal(dir.path().join("goals"), "nope").unwrap().is_none());
    }

    #[test]
    fn broken_file_is_reported() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        std::fs::write(goals_dir.join("bad.md"), "---\nstatus: invalid_status\n---\n# x\n").unwrap();
        let result = read_all_goals(&goals_dir).unwrap();
        assert!(result.goals.is_empty());
        assert_eq!(result.broken.len(), 1);
        assert_eq!(result.broken[0].id, "bad");
    }

    #[test]
    fn update_goal_partial_patch() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        let goal = write_goal(&goals_dir, &sample_input(), &HashSet::new()).unwrap();
        let created_before = goal.created.clone();

        std::thread::sleep(std::time::Duration::from_secs(1));
        let patch = GoalPatch { status: Some(GoalStatus::Done), ..Default::default() };
        let updated = update_goal(&goals_dir, &goal.id, &patch).unwrap();
        assert_eq!(updated.status, GoalStatus::Done);
        assert_eq!(updated.created, created_before);
        assert_ne!(updated.updated, created_before);
        assert_eq!(updated.title, "拿国奖");
    }

    #[test]
    fn update_goal_clear_progress_via_some_none() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        let goal = write_goal(&goals_dir, &sample_input(), &HashSet::new()).unwrap();
        assert!(goal.progress.is_some());

        let patch = GoalPatch { progress: Some(None), ..Default::default() };
        let updated = update_goal(&goals_dir, &goal.id, &patch).unwrap();
        assert!(updated.progress.is_none());
    }

    #[test]
    fn delete_goal_removes_file() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        let goal = write_goal(&goals_dir, &sample_input(), &HashSet::new()).unwrap();
        assert!(goals_dir.join(format!("{}.md", goal.id)).exists());
        delete_goal(&goals_dir, &goal.id).unwrap();
        assert!(!goals_dir.join(format!("{}.md", goal.id)).exists());
    }

    #[test]
    fn progress_field_absent_in_frontmatter_when_none() {
        let dir = temp_goals_dir();
        let goals_dir = dir.path().join("goals");
        let mut input = sample_input();
        input.progress = None;
        let goal = write_goal(&goals_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(goals_dir.join(format!("{}.md", goal.id))).unwrap();
        assert!(!raw.contains("progress:"), "frontmatter leaked empty progress field");
    }
}
