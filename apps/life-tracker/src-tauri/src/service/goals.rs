//! goal 业务逻辑 —— 包装 data/goals,加容错和 ID 复用。

use std::collections::HashSet;
use std::path::Path;

use crate::data::goals as data;
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

/// 删除一个目标。
pub fn delete_goal(goals_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    data::delete_goal(goals_dir, id)
}
