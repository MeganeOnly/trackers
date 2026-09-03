//! Tauri commands —— 把 service 层暴露给 renderer。
//!
//! 与 `src/shared/api.ts` 的 `ElectronAPI` 1:1 对应(命令名 snake_case)。

use std::collections::HashMap;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::data::books::{BrokenEntry as DataBrokenEntry, BookListResult};
use crate::service::{books, config as cfg_svc, data_dir, ranking, relations};
use crate::types::{Book, BookInput, BookPatch, CharacterNotes, Config, Edge, EpisodeNotes, PairwiseResult, RankingFile, SeasonInfo, TimeStamp};

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

// ==================== v1.2 集笔记 commands ====================

/// 整段替换季信息。`seasons: []` 等同"清空"。
#[tauri::command]
pub fn books_seasons_set(id: String, seasons: Vec<SeasonInfo>) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_seasons(&dir, &id, seasons).map_err(|e| e.to_string())
}

/// 切换单集 watched。
#[tauri::command]
pub fn books_episode_set_watched(
    id: String,
    season: u32,
    episode: u32,
    watched: bool,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_episode_watched(&dir, &id, season, episode, watched).map_err(|e| e.to_string())
}

/// 设置单集笔记。空串 → 删 key(最稀疏)。
///
/// v1.5 起:`last_modified`(毫秒;Option<u64>)为 Some(非 0)且 note 非空时刷该集时间戳;
/// 空串"删笔记"不刷。watched toggle 不走此 command(走 set_episode_watched)。
#[tauri::command]
pub fn books_episode_set_note(
    id: String,
    season: u32,
    episode: u32,
    note: String,
    last_modified: Option<u64>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_episode_note(&dir, &id, season, episode, note, last_modified).map_err(|e| e.to_string())
}

/// 设置单集标题。空串 → 删 title 字段(若该集无任何字段,key 也删)。
///
/// v1.5 起:`last_modified`(毫秒;Option<u64>)为 Some(非 0)且 title 非空时刷该集时间戳;
/// 空串"删 title"不刷。
#[tauri::command]
pub fn books_episode_set_title(
    id: String,
    season: u32,
    episode: u32,
    title: String,
    last_modified: Option<u64>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_episode_title(&dir, &id, season, episode, title, last_modified).map_err(|e| e.to_string())
}

/// 清空整部剧的所有 episodes。
#[tauri::command]
pub fn books_episodes_clear(id: String) -> Result<Book, String> {
    let dir = books_dir()?;
    books::clear_episodes(&dir, &id).map_err(|e| e.to_string())
}

/// 进度 +1/-1 联动集笔记。`delta > 0` 时同时把接下来的集标 watched。
#[tauri::command]
pub fn books_episode_bump(id: String, delta: i32) -> Result<Book, String> {
    let dir = books_dir()?;
    books::episode_bump(&dir, &id, delta).map_err(|e| e.to_string())
}

/// 整体替换 episodes(留给未来 batch 操作 / 导入;v1.2 UI 不直接调用)。
#[allow(dead_code)]
#[tauri::command]
pub fn books_episodes_set(id: String, episodes: EpisodeNotes) -> Result<Book, String> {
    let dir = books_dir()?;
    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    books::update_book(&dir, &id, &patch).map_err(|e| e.to_string())
}

/// 整体替换单集的时间戳笔记数组(v1.3 新增,v1.5 加 last_modified)。
/// - `stamps: []` → 清空该集所有 stamp(若该集也没其他字段则删 key);不刷 last_modified
/// - `stamps: [...]` → 整体替换 + 服务端按 start 升序重新排序;
///   `last_modified`(毫秒;Option<u64>)为 Some(非 0)时刷该集时间戳
#[tauri::command]
pub fn books_episode_set_stamps(
    id: String,
    season: u32,
    episode: u32,
    stamps: Vec<TimeStamp>,
    last_modified: Option<u64>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_episode_stamps(&dir, &id, season, episode, stamps, last_modified).map_err(|e| e.to_string())
}

// ==================== v1.5 角色笔记 commands ====================

/// 整段替换角色笔记数组(v1.5 新增)。
/// `characters: []` 等同"清空";稀疏写盘策略见 `data::books::persist` + `service::books::set_characters`。
#[tauri::command]
pub fn books_characters_set(
    id: String,
    characters: CharacterNotes,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_characters(&dir, &id, characters).map_err(|e| e.to_string())
}

// ==================== v1.6 「下一季」commands ====================

/// 设置 / 清除「下一季」关联(v1.6 新增)。
/// `next_season_id: None` 或 `Some("")` 等同"清除"(不写 frontmatter)。
/// 禁止 self-loop(id 跟 next_season_id 相同 → Err)。
/// 目标 book 不存在时不拒绝写盘,由前端 UI 兜底「原作品已删除」提示。
#[tauri::command]
pub fn books_set_next_season(
    id: String,
    next_season_id: Option<String>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_next_season(&dir, &id, next_season_id).map_err(|e| e.to_string())
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
