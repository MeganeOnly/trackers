//! book-tracker Tauri entry point.
//!
//! P0 阶段只暴露 `ping` 一个 command 验证编译。
//! 真正的 IPC 通道(books_*/relations_*/config_*/data_*)在 P3-P4 阶段接入。

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
