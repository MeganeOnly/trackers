//! book-tracker Tauri entry point.
//!
//! 模块结构:
//! - `types` / `progress` / `unlock` —— 纯函数(P1)
//! - `data` —— 文件 I/O + matter frontmatter 解析(P2)
//! - `service` —— 业务逻辑包装(P3)
//! - `commands` —— `#[tauri::command]` 暴露给前端(P4)
//!
//! 注意:`tauri` 相关的代码全部用 `#[cfg(not(test))]` 隔离,
//! 这样 `cargo test` 时不会拉入 webview2 / wry 等大依赖,
//! 测试可执行文件可以正常加载。

pub mod data;
pub mod progress;
pub mod types;
pub mod unlock;

#[cfg(not(test))]
pub mod commands;

#[cfg(not(test))]
pub mod service;

#[cfg(not(test))]
mod tauri_app {
    use tauri_plugin_dialog::DialogExt;

    use crate::commands;
    use crate::service::data_dir;

    #[tauri::command]
    pub fn ping() -> &'static str {
        "pong"
    }

    /// 应用启动时调用:确保 data_dir 已选定(必要时弹 picker)。
    /// 命令由 frontend 在挂载完成后调用 `app_pick_or_get_data_dir()`。
    #[tauri::command]
    pub fn app_ensure_data_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
        // 先尝试从 cache 拿
        if let Ok(d) = data_dir::get_cached() {
            return Ok(d);
        }
        // 读应用层 config
        let app_cfg = data_dir::read_app_config_for_cmd();
        if !app_cfg.data_dir.is_empty() && std::path::Path::new(&app_cfg.data_dir).is_dir() {
            data_dir::set_cached(app_cfg.data_dir.clone());
            return Ok(app_cfg.data_dir);
        }
        // 没选过,弹 picker(对话框初始化后才能用 dialog,所以这里直接返回空)
        let _ = app.dialog();
        Err("data dir not selected; please call data:pickDir".to_string())
    }

    #[cfg_attr(mobile, tauri::mobile_entry_point)]
    pub fn run() {
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .invoke_handler(tauri::generate_handler![
                ping,
                app_ensure_data_dir,
                commands::books_list,
                commands::books_get,
                commands::books_create,
                commands::books_update,
                commands::books_progress_bump,
                commands::books_delete,
                commands::relations_get,
                commands::relations_set,
                commands::config_get,
                commands::config_set,
                commands::data_pick_dir,
                commands::data_reveal_in_explorer,
            ])
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri_app::run()
}
