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
mod commands {
    use tauri;

    #[tauri::command]
    pub fn ping() -> &'static str {
        "pong"
    }
}

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
