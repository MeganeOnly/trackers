//! goal 业务逻辑 —— 包装 data/goals,加容错和 ID 复用。
//!
//! 删除走回收站（service/trash.rs）：原始 .md 移到 `.trash/goals/`，涉及该 goal
//! 的 edges 移到 `.trash/relations/`，relations.json 重写。data/goals.rs::delete_goal
//! 保留作为底层 API，service 层不再暴露"绕过回收站的硬删"路径。

use std::collections::HashSet;
use std::path::Path;

use crate::data::goals as data;
use crate::service::trash;
use crate::types::{Goal, GoalInput, GoalPatch};

/// 列出所有目标 + 损坏列表。
pub fn list_goals(goals_dir: impl AsRef<Path>) -> std::io::Result<data::GoalListResult> {
    data::read_all_goals(goals_dir)
}

/// 读取一个目标。
pub fn get_goal(goals_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Goal>> {
    data::read_goal(goals_dir, id)
}

/// 创建一个目标 —— 自动分配新 ID。
pub fn create_goal(goals_dir: impl AsRef<Path>, input: &GoalInput) -> std::io::Result<Goal> {
    let ids: HashSet<String> = data::list_goal_ids(&goals_dir)?.into_iter().collect();
    data::write_goal(&goals_dir, input, &ids)
}

/// 更新一个目标 —— patch 合并。
pub fn update_goal(goals_dir: impl AsRef<Path>, id: &str, patch: &GoalPatch) -> std::io::Result<Goal> {
    data::update_goal(goals_dir, id, patch)
}

/// 快速调整 progress。
pub fn bump_progress(goals_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Goal> {
    data::bump_progress(goals_dir, id, delta)
}

/// 删除一个目标 —— **走回收站**，可还原。接 `data_dir`（不是 goals_dir）
/// 是因为同时要改 relations.json。
pub fn delete_goal(data_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    trash::move_to_trash(data_dir, id)
}
