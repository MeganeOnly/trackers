//! Tauri commands —— 把 service 层暴露给 renderer。
//!
//! 与 `src/shared/api.ts` 的 `ElectronAPI` 1:1 对应(命令名 snake_case)。

use std::collections::HashMap;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::data::books::{BrokenEntry as DataBrokenEntry, BookListResult};
use crate::service::{books, candidates, config as cfg_svc, data_dir, ranking, relations, series as series_svc};
use crate::types::{Book, BookInput, BookPatch, Candidate, CharacterNotes, Config, Edge, EpisodeNotes, PairwiseResult, PromoteStatus, RankingFile, SeasonInfo, Series, SeriesInput, SeriesPatch, TimeStamp};

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

// ==================== v2.x 顶层 stamps commands ====================

/// 整体替换作品的顶层 `stamps` 数组(v2.x 新增;目前仅 movie 实际使用)。
///
/// - `stamps: []` → 清空(整段不写 frontmatter)
/// - `stamps: [...]` → 整体替换 + 服务端按 start 升序重新排序
/// - `last_modified` 参数保留以与 `books_episode_set_stamps` API 对齐;
///   单 stamp 自带 per-row `last_modified`,book 层不单独刷顶层时间戳
/// - **不联动 `book.updated`**:与 `EpisodeRecord.stamps` 同款语义
///   (stamps 自带 per-row 时间戳,parent 时间戳不该被 stamps 改动触发)
#[tauri::command]
pub fn books_set_stamps(
    id: String,
    stamps: Vec<TimeStamp>,
    last_modified: Option<u64>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_stamps(&dir, &id, stamps, last_modified).map_err(|e| e.to_string())
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

/// 设置 / 清除「上一季」关联(v2.x 新增;用户主动设)。
/// `prev_season_id: None` 或 `Some("")` 等同"清除"(不写 frontmatter,且
/// `prev_season_explicit` 重置为 false)。设值时会同步写 `prev_season_explicit = true`
/// 作为"粘性"标记,`set_next_season` 反向清理路径看到该标记会跳过 —— 保护用户显式表达。
/// 禁止 self-loop,目标 book 不存在时仍写盘(同 set_next_season)。
/// **不联动 next 方向**:本命令不修改 prev 目标书的 `next_season_id`。
#[tauri::command]
pub fn books_set_prev_season(
    id: String,
    prev_season_id: Option<String>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_prev_season(&dir, &id, prev_season_id).map_err(|e| e.to_string())
}

// ==================== v1.7 「所属系列」commands ====================

/// 设置 / 清除「所属系列」(v1.7 新增)。
/// `series_id: None` 或 `Some("")` 等同"清除"(不写 frontmatter)。
/// 目标 series 不存在时不拒绝写盘,由前端 UI 兜底「该系列已删除」提示
/// (跟 v1.6 set_next_season 同款精神)。
#[tauri::command]
pub fn books_set_series(
    id: String,
    series_id: Option<String>,
) -> Result<Book, String> {
    let dir = books_dir()?;
    books::set_series(&dir, &id, series_id).map_err(|e| e.to_string())
}

// ==================== v1.7 series commands ====================

/// 列出所有 series(按 id 升序)。
#[tauri::command]
pub fn series_list() -> Result<Vec<Series>, String> {
    let dir = data_dir_path()?;
    series_svc::list_series(&dir).map_err(|e| e.to_string())
}

/// 读单个 series。id 不存在 → Ok(None)。
#[tauri::command]
pub fn series_get(id: String) -> Result<Option<Series>, String> {
    let dir = data_dir_path()?;
    series_svc::get_series(&dir, &id).map_err(|e| e.to_string())
}

/// 创建新 series。name 必填;空 / 纯空白 → Err(InvalidInput → JS 异常)。
#[tauri::command]
pub fn series_create(input: SeriesInput) -> Result<Series, String> {
    let dir = data_dir_path()?;
    series_svc::create_series(&dir, &input).map_err(|e| e.to_string())
}

/// 更新 series。id 不存在 → Err(NotFound);name 设为空 → Err(InvalidInput)。
#[tauri::command]
pub fn series_update(id: String, patch: SeriesPatch) -> Result<Series, String> {
    let dir = data_dir_path()?;
    series_svc::update_series(&dir, &id, &patch).map_err(|e| e.to_string())
}

/// 删除 series。id 不存在 → Err(NotFound)。
/// 联动清理所有 book 的 series_id 引用(走 service 层,
/// 跟 delete_book 清理 nextSeasonId / prevSeasonId 同款)。
#[tauri::command]
pub fn series_delete(id: String) -> Result<(), String> {
    let dir = data_dir_path()?;
    series_svc::delete_series(&dir, &id).map_err(|e| e.to_string())
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

// ==================== app-level commands ====================

/// 打开「集笔记便签」独立小窗口(v2.x 新增)。
///
/// 行为:
/// - 若 `sticky` 标签窗口已存在 → 聚焦并 unminimize,**不**重建(避免状态丢失)
/// - 若不存在 → 创建新 webview window,加载 `index.html#/sticky` 路由,
///   由 React 检测 hash 渲染只含 `<EpisodeNotesSticky />` 的简化版 app
///
/// 设计意图:
/// - 用户场景:看剧时随手记时间戳,**真正独立于主 app**(可拖到第二屏幕、
///   关主 app 后仍可见)。不是主 app 内的浮层。
/// - 两个窗口共享 localStorage(zustand `episodeSticky` store 自动 hydrate),
///   所以主 app 选定的 book / 季 / 集 在 sticky 窗口打开后立刻可见;
///   sticky 窗口里的改动(选 book / 切集 / 加 stamp)通过 emit 'book-changed'
///   事件 + IPC 同步到主 app(主 app 监听后 loadBooks() 刷新)。
///
/// 配置参数:
/// - 400x480(便签大小,可拖拽 resize)
/// - `skip_taskbar: true` —— 不在任务栏占位(避免 1 个便签挤占一个任务栏图标)
/// - `decorations: true` —— 保留 OS 标题栏,用户可原生拖拽 + 最小化 + 关闭
///   (× 按钮和 OS 关闭按钮都能关窗口)
///
/// **不**用 always_on_top:用户反馈"感觉不像普通窗口"——置顶窗口会被其他 app 盖不到,
/// 跟 macOS Stickies / Windows 记事贴的"普通窗口"心智不符。改成"可以被其他 app
/// 盖住"的正常行为后,用户自己用 OS 切到便签窗口时仍是顶层(OS 焦点机制)。
#[tauri::command]
pub async fn open_sticky_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    use tauri::WebviewUrl;
    use tauri::WebviewWindowBuilder;

    const LABEL: &str = "sticky";

    // 已存在 → 聚焦并 unminimize 后返回
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    // 不存在 → 创建新 webview window,加载 index.html#/sticky 路由
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html#/sticky".into()))
        .title("集笔记便签")
        .inner_size(400.0, 480.0)
        .min_inner_size(320.0, 280.0)
        .skip_taskbar(true)
        .decorations(true)
        .build()
        .map_err(|e| format!("create sticky window: {e}"))?;

    Ok(())
}

// ==================== candidates commands ====================

#[tauri::command]
pub fn candidates_list() -> Result<Vec<Candidate>, String> {
    let dir = data_dir_path()?;
    candidates::list(&dir)
        .map(|f| f.items)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn candidates_add(
    title: String,
    tags: Vec<String>,
    note: Option<String>,
) -> Result<Candidate, String> {
    let dir = data_dir_path()?;
    candidates::add(&dir, &title, &tags, note.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn candidates_remove(id: String) -> Result<(), String> {
    let dir = data_dir_path()?;
    candidates::remove(&dir, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn candidates_promote(id: String, status: PromoteStatus) -> Result<Book, String> {
    let dir = data_dir_path()?;
    candidates::promote(&dir, &id, status).map_err(|e| e.to_string())
}
