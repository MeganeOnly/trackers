//! Tauri commands —— 把 service 层暴露给 renderer。
//!
//! 与 `src/shared/api.ts` 的 `ElectronAPI` 1:1 对应(命令名 snake_case)。

use std::collections::HashMap;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::data::books::{BrokenEntry as DataBrokenEntry, BookListResult};
use crate::service::{books, config as cfg_svc, data_dir, ranking, relations};
use crate::types::{Book, BookInput, BookPatch, Config, Edge, PairwiseResult, RankingFile};

/// 把 data 层的 BrokenEntry 转换成 renderer 期望的格式(plain struct)。
fn to_broken(b: DataBrokenEntry) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("id".to_string(), b.id);
    m.insert("error".to_string(), b.error);
    m
}

fn to_book_list(r: BookListResult) -> HashMap<String, serde_json::Value> {
    let mut m = HashMap::new();
    m.insert(
        "books".to_string(),
        serde_json::to_value(r.books).unwrap_or(serde_json::Value::Null),
    );
    m.insert(
        "broken".to_string(),
        serde_json::to_value(r.broken.into_iter().map(to_broken).collect::<Vec<_>>())
            .unwrap_or(serde_json::Value::Null),
    );
    m
}

fn books_dir() -> Result<String, String> {
    data_dir::get_cached().map(|d| crate::data::config::paths::books_dir(&d).to_string_lossy().to_string())
}

fn data_dir_path() -> Result<String, String> {
    data_dir::get_cached()
}

// ==================== book commands ====================

#[tauri::command]
pub fn books_list() -> Result<HashMap<String, serde_json::Value>, String> {
    let dir = books_dir()?;
    books::list_books(&dir)
        .map(to_book_list)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn books_get(id: String) -> Result<Option<Book>, String> {
    let dir = books_dir()?;
    books::get_book(&dir, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn books_create(input: BookInput) -> Result<Book, String> {
    let dir = books_dir()?;
    books::create_book(&dir, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn books_update(id: String, patch: BookPatch) -> Result<Book, String> {
    let dir = books_dir()?;
    books::update_book(&dir, &id, &patch).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn books_progress_bump(id: String, delta: i32) -> Result<Book, String> {
    let dir = books_dir()?;
    books::bump_progress(&dir, &id, delta).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn books_delete(id: String) -> Result<(), String> {
    let dir = books_dir()?;
    books::delete_book(&dir, &id).map_err(|e| e.to_string())
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
pub fn config_get() -> Result<Config, String> {
    let dir = data_dir_path()?;
    cfg_svc::get_config(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn config_set(patch: cfg_svc::ConfigPatch) -> Result<Config, String> {
    let dir = data_dir_path()?;
    cfg_svc::set_config(&dir, patch).map_err(|e| e.to_string())
}

// ==================== ranking commands ====================

/// 读 ranking 文件（缺失 → 默认空 RankingFile）。
#[tauri::command]
pub fn ranking_get() -> Result<RankingFile, String> {
    let dir = data_dir_path()?;
    ranking::get_ranking(&dir).map_err(|e| e.to_string())
}

/// 追加一次对比结果；服务端覆盖 ts 后写回整文件，返回写后的 RankingFile。
///
/// 前端拿到新 RankingFile 后会用本地 books 池 + 新 history 重算评分。
#[tauri::command]
pub fn ranking_apply(result: PairwiseResult) -> Result<RankingFile, String> {
    let dir = data_dir_path()?;
    ranking::append_result(&dir, result).map_err(|e| e.to_string())
}

// ==================== data commands ====================

/// 弹原生文件夹选择器,选完后自动初始化 data_dir。
/// 取消返回 `Ok(None)`。
#[tauri::command]
pub async fn data_pick_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    // 用 tauri-plugin-dialog 异步弹出
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
