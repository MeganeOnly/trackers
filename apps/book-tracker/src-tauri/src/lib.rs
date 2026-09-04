//! book-tracker Tauri entry point.
//!
//! 模块结构:
//! - `types` —— Book 领域类型(Rust serde 镜像)
//! - `data` —— Book 文件 I/O + frontmatter 解析
//! - `service` —— 业务逻辑包装
//! - `commands` —— `#[tauri::command]` 暴露给前端
//!
//! 通用内核(前置图 / 进度 / 文件 I/O / config / data_dir)来自 `tracker-core`(monorepo 共享)。
//!
//! 注意:`tauri` 相关的代码全部用 `#[cfg(not(test))]` 隔离,
//! 这样 `cargo test` 时不会拉入 webview2 / wry 等大依赖,
//! 测试可执行文件可以正常加载。

pub mod data;
pub mod types;

// service / commands 跟 tauri 无关,可以在 test 时加载 —— 但只在
// book-tracker 这个 src-tauri 里对 service::books::set_next_season 测
// 双向同步(v1.6 起)。tauri_app 自身仍 cfg(not(test)) 隔离,避免
// cargo test 拉 webview2 / wry。
pub mod service;

#[cfg(not(test))]
pub mod commands;

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
                commands::books_seasons_set,
                commands::books_episode_set_watched,
                commands::books_episode_set_note,
                commands::books_episode_set_title,
                commands::books_episodes_clear,
                commands::books_episode_bump,
                commands::books_episode_set_stamps,
                commands::books_episodes_set,
                commands::books_characters_set,
                commands::books_set_next_season,
                commands::relations_get,
                commands::relations_set,
                commands::config_get,
                commands::config_set,
                commands::ranking_get,
                commands::ranking_apply,
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
