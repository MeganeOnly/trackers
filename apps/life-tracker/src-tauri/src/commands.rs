//! Tauri commands —— 把 service 层暴露给 renderer。
//!
//! 与 `src/shared/api.ts` 的 `ElectronAPI` 1:1 对应(命令名 snake_case)。

use std::collections::HashMap;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::data::goals::{BrokenEntry as DataBrokenEntry, GoalListResult};
use crate::service::{config as cfg_svc, data_dir, goals, relations, trash};
use crate::types::{Edge, Goal, GoalInput, GoalPatch};

/// 把 data 层的 BrokenEntry 转换成 renderer 期望的格式(plain struct)。
fn to_broken(b: DataBrokenEntry) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("id".to_string(), b.id);
    m.insert("error".to_string(), b.error);
    m
}

fn to_goal_list(r: GoalListResult) -> HashMap<String, serde_json::Value> {
    let mut m = HashMap::new();
    m.insert(
        "goals".to_string(),
        serde_json::to_value(r.goals).unwrap_or(serde_json::Value::Null),
    );
    m.insert(
        "broken".to_string(),
        serde_json::to_value(r.broken.into_iter().map(to_broken).collect::<Vec<_>>())
            .unwrap_or(serde_json::Value::Null),
    );
    m
}

fn goals_dir() -> Result<String, String> {
    data_dir::get_cached().map(|d| crate::data::config::paths::goals_dir(&d).to_string_lossy().to_string())
}

fn data_dir_path() -> Result<String, String> {
    data_dir::get_cached()
}

// ==================== goal commands ====================

#[tauri::command]
pub fn goals_list() -> Result<HashMap<String, serde_json::Value>, String> {
    let dir = goals_dir()?;
    goals::list_goals(&dir)
        .map(to_goal_list)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn goals_get(id: String) -> Result<Option<Goal>, String> {
    let dir = goals_dir()?;
    goals::get_goal(&dir, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn goals_create(input: GoalInput) -> Result<Goal, String> {
    let dir = goals_dir()?;
    goals::create_goal(&dir, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn goals_update(id: String, patch: GoalPatch) -> Result<Goal, String> {
    let dir = goals_dir()?;
    goals::update_goal(&dir, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn goals_progress_bump(id: String, delta: i32) -> Result<Goal, String> {
    let dir = goals_dir()?;
    goals::bump_progress(&dir, &id, delta).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn goals_delete(id: String) -> Result<(), String> {
    let dir = data_dir_path()?;
    goals::delete_goal(&dir, &id).map_err(|e| e.to_string())
}

// ==================== relations commands ====================

#[tauri::command]
pub fn relations_get() -> Result<Vec<Edge>, String> {
    let dir = data_dir_path()?;
    relations::get_relations(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn relations_set(edges: Vec<Edge>) -> Result<(), String> {
    let dir = data_dir_path()?;
    relations::set_relations(&dir, edges).map_err(|e| e.to_string())
}

// ==================== config commands ====================

#[tauri::command]
pub fn config_get() -> Result<crate::types::Config, String> {
    let dir = data_dir_path()?;
    cfg_svc::get_config(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn config_set(patch: cfg_svc::ConfigPatch) -> Result<crate::types::Config, String> {
    let dir = data_dir_path()?;
    cfg_svc::set_config(&dir, patch).map_err(|e| e.to_string())
}

// ==================== data commands ====================

/// 弹原生文件夹选择器,选完后自动初始化 data_dir。
/// 取消返回 `Ok(None)`。
#[tauri::command]
pub async fn data_pick_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().clone();
    let picked = dialog
        .file()
        .set_title("选择数据目录")
        .blocking_pick_folder();
    let Some(folder) = picked else { return Ok(None) };
    let path_str = folder
        .into_path()
        .map_err(|e| format!("invalid path: {e}"))?
        .to_string_lossy()
        .to_string();

    // 初始化:重置 cache,写默认 config
    data_dir::reset();
    let result = data_dir::init_with_picker(|| Some(path_str.clone()));
    match result {
        Ok(d) => {
            // 顺手把 data_dir 写入数据层 config
            let _ = cfg_svc::set_config(
                &d,
                cfg_svc::ConfigPatch::default(),
            );
            Ok(Some(d))
        }
        Err(e) => Err(e),
    }
}

/// 在系统文件管理器中打开 data_dir。
#[tauri::command]
pub fn data_reveal_in_explorer<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = data_dir::get_cached()?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(dir, None::<&str>)
        .map_err(|e| e.to_string())
}

// ==================== trash commands ====================

/// 列出回收站条目（按删除时间倒序）。
#[tauri::command]
pub fn trash_list() -> Result<Vec<trash::TrashEntry>, String> {
    let dir = data_dir_path()?;
    trash::list_trash(&dir).map_err(|e| e.to_string())
}

/// 从回收站还原一个目标到 goals/ + 合并回 relations。
/// 引入循环依赖时返回 Err，goals/<id>.md 也会回滚。
#[tauri::command]
pub fn trash_restore(id: String, deleted_at: i64) -> Result<Goal, String> {
    let dir = data_dir_path()?;
    trash::restore_from_trash(&dir, &id, deleted_at).map_err(|e| e.to_string())
}

/// 永久删除一个回收站条目。
#[tauri::command]
pub fn trash_purge(id: String, deleted_at: i64) -> Result<(), String> {
    let dir = data_dir_path()?;
    trash::purge_from_trash(&dir, &id, deleted_at).map_err(|e| e.to_string())
}

/// 清空回收站，返回删除的文件总数。
#[tauri::command]
pub fn trash_empty() -> Result<usize, String> {
    let dir = data_dir_path()?;
    trash::empty_trash(&dir).map_err(|e| e.to_string())
}
