//! book.md 读写(frontmatter via 手写 JSON parser)。
//!
//! - 每本书一个 `<id>.md`,frontmatter 是单行 JSON,正文是 Markdown
//! - `progress` 字段只在有值时写入,避免污染 frontmatter
//! - 损坏文件不阻塞其他书加载,返回 broken 列表
//!
//! 通用工具（原子写 / 数字 ID / frontmatter 拆分 / ISO 时间戳 / 进度纯函数）
//! 来自 monorepo 共享内核 `tracker-core`。

use std::collections::HashSet;
use std::path::Path;

use tracker_core::files::{atomic_write_file, ensure_dir};
use tracker_core::frontmatter::{now_iso, split_frontmatter};
use tracker_core::progress::{bump_progress as bump_progress_helper, normalize_progress_input};
use tracker_core::slug::make_base_id;
use crate::types::{Book, BookInput, BookPatch, BookStatus, Character, CharacterNotes, EpisodeNotes, EpisodeRecord, SeasonInfo, TimeStamp, WorkKind};

fn is_valid_status(s: &str) -> bool {
    matches!(
        s,
        "want" | "shelved" | "reading" | "watching" | "finished" | "abandoned"
    )
}

/// 列出所有书的 ID(从文件名读)。
pub fn list_book_ids(books_dir: impl AsRef<Path>) -> std::io::Result<Vec<String>> {
    ensure_dir(&books_dir)?;
    let mut ids = Vec::new();
    for entry in std::fs::read_dir(books_dir.as_ref())? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.ends_with(".md") {
            ids.push(name.trim_end_matches(".md").to_string());
        }
    }
    Ok(ids)
}

/// 读取一本书。文件不存在 → `Ok(None)`。
pub fn read_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Book>> {
    let path = books_dir.as_ref().join(format!("{id}.md"));
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let (data, _body) = split_frontmatter(&raw)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing frontmatter"))?;
    let status = data
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing status"))?;
    if !is_valid_status(status) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid status: {status}"),
        ));
    }
    Ok(Some(normalize_book(id, &data)))
}

fn normalize_book(id: &str, data: &serde_json::Value) -> Book {
    Book {
        id: id.to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        kind: WorkKind::parse(data.get("kind").and_then(|v| v.as_str())),
        author: data.get("author").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        country: data.get("country").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        year: data.get("year").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        translator: data.get("translator").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        status: parse_status(data.get("status")),
        read_count: data.get("read_count").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
        progress: data.get("progress").and_then(tracker_core::progress::parse_progress),
        collapsed: data.get("collapsed").and_then(|v| v.as_bool()).unwrap_or(false),
        created: data.get("created").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        updated: data.get("updated").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        tags: data
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        notes: data.get("notes").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        starring: data.get("starring").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        screenwriter: data.get("screenwriter").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        seasons: parse_seasons(data.get("seasons")),
        episodes: parse_episodes(data.get("episodes")),
        characters: parse_characters(data.get("characters")),
        // v1.6:next_season_id —— 字段缺损 / 非字符串 / 空串 → None（向后兼容;老文件无此字段）
        next_season_id: data
            .get("nextSeasonId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
    }
}

/// 解析 frontmatter `seasons` 数组。`None` / 空数组 / 元素字段缺失 → None（最稀疏策略）。
/// `last_modified` 字段缺损 / 非数字 → None（向后兼容;老数据无此字段）。
fn parse_seasons(v: Option<&serde_json::Value>) -> Option<Vec<SeasonInfo>> {
    let arr = v?.as_array()?;
    let mut seasons = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        let Some(number) = obj.get("number").and_then(|x| x.as_u64()) else { continue };
        let Some(episode_count) = obj.get("episodeCount").and_then(|x| x.as_u64()) else { continue };
        let notes = obj.get("notes").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(String::from);
        let last_modified = obj.get("lastModified").and_then(|x| x.as_u64()).filter(|&n| n > 0);
        seasons.push(SeasonInfo {
            number: number as u32,
            episode_count: episode_count as u32,
            notes,
            last_modified,
        });
    }
    if seasons.is_empty() { None } else { Some(seasons) }
}

/// 解析 frontmatter `episodes` 对象。`None` / 空对象 / 子对象字段缺失 → None（最稀疏策略）。
/// 任一非对象 value 容错跳过（不抛错,避免坏数据整本不可读）。
/// `last_modified` 字段缺损 / 非数字 / 0 → None（向后兼容;老数据无此字段）。
fn parse_episodes(v: Option<&serde_json::Value>) -> Option<EpisodeNotes> {
    let obj = v?.as_object()?;
    let mut map = EpisodeNotes::new();
    for (k, val) in obj {
        let Some(rec_obj) = val.as_object() else { continue };
        let watched = rec_obj.get("watched").and_then(|x| x.as_bool()).unwrap_or(false);
        let note = rec_obj.get("note").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let title = rec_obj.get("title").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(String::from);
        let stamps = parse_stamps(rec_obj.get("stamps"));
        let last_modified = rec_obj.get("lastModified").and_then(|x| x.as_u64()).filter(|&n| n > 0);
        map.insert(k.clone(), EpisodeRecord { watched, note, title, stamps, last_modified });
    }
    if map.is_empty() { None } else { Some(map) }
}

/// 解析 frontmatter `characters` 数组（v1.5 新增）。
///
/// 稀疏策略:
/// - `None` / 空数组 → `None`（不写盘）
/// - 单条 character `name` 为空 → 跳过该条（脏数据防御）;
///   实际"删除 character"由前端在 IPC 前过滤掉,这里只兜底
/// - 单条 character `notes` 空 → 保留条目,notes 字段为 None
/// - `last_modified` 字段缺损 / 非数字 / 0 → None
/// - 任一非对象元素 → 跳过（不抛错,避免坏数据整本不可读）
fn parse_characters(v: Option<&serde_json::Value>) -> Option<CharacterNotes> {
    let arr = v?.as_array()?;
    let mut chars = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        // 必填:id / name 缺一不可 —— 缺失就跳过(避免坏数据整本不可读)
        let Some(id) = obj.get("id").and_then(|x| x.as_str()) else { continue };
        let Some(name) = obj.get("name").and_then(|x| x.as_str()) else { continue };
        // name 空 → 兜底跳过(同前端 IPC 前过滤的语义)
        if name.is_empty() { continue; }
        let notes = obj.get("notes").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(String::from);
        let last_modified = obj.get("lastModified").and_then(|x| x.as_u64()).filter(|&n| n > 0);
        chars.push(Character {
            id: id.to_string(),
            name: name.to_string(),
            notes,
            last_modified,
        });
    }
    if chars.is_empty() { None } else { Some(chars) }
}

/// 解析单集 `stamps` 数组。`None` / 空数组 / 任一非对象元素 → None（最稀疏）。
/// 时间戳按 `start` 升序排序（同 start 按 id 字典序），与前端 `sortStamps` 一致。
fn parse_stamps(v: Option<&serde_json::Value>) -> Option<Vec<TimeStamp>> {
    let arr = v?.as_array()?;
    let mut stamps = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        // 必填字段:id / start / note 缺一不可 —— 缺失就跳过(避免坏数据整本不可读)
        let Some(id) = obj.get("id").and_then(|x| x.as_str()) else { continue };
        let Some(start) = obj.get("start").and_then(|x| x.as_u64()) else { continue };
        // note 字段缺损 / 非字符串 → 当空串(等同"无笔记"语义)
        let note = obj.get("note").and_then(|x| x.as_str()).unwrap_or("").to_string();
        // end 字段缺损 / 非数字 → None(单时间点 vs 时间段)
        let end = obj.get("end").and_then(|x| x.as_u64()).map(|n| n as u32);
        stamps.push(TimeStamp {
            id: id.to_string(),
            start: start as u32,
            end,
            note,
        });
    }
    if stamps.is_empty() {
        return None;
    }
    // 按 start 升序排序;同 start 按 id 字典序(保证稳定排序)
    stamps.sort_by(|a, b| {
        if a.start != b.start {
            return a.start.cmp(&b.start);
        }
        a.id.cmp(&b.id)
    });
    Some(stamps)
}

fn parse_status(v: Option<&serde_json::Value>) -> BookStatus {
    match v.and_then(|x| x.as_str()) {
        Some("want") => BookStatus::Want,
        Some("shelved") => BookStatus::Shelved,
        Some("reading") => BookStatus::Reading,
        Some("watching") => BookStatus::Watching,
        Some("finished") => BookStatus::Finished,
        Some("abandoned") => BookStatus::Abandoned,
        _ => BookStatus::Want,
    }
}

/// 批量读所有书,跳过损坏文件,返回损坏列表。
pub fn read_all_books(books_dir: impl AsRef<Path>) -> std::io::Result<BookListResult> {
    let ids = list_book_ids(&books_dir)?;
    let mut books = Vec::new();
    let mut broken = Vec::new();
    for id in ids {
        match read_book(&books_dir, &id) {
            Ok(Some(b)) => books.push(b),
            Ok(None) => {}
            Err(e) => broken.push(BrokenEntry { id, error: e.to_string() }),
        }
    }
    Ok(BookListResult { books, broken })
}

#[derive(Debug, Clone)]
pub struct BrokenEntry {
    pub id: String,
    pub error: String,
}

/// `read_all_books` 的返回结构(books + broken 列表)。
#[derive(Debug, Clone)]
pub struct BookListResult {
    pub books: Vec<Book>,
    pub broken: Vec<BrokenEntry>,
}

/// 写入一本书(新建)。返回写入后的 Book(含 id)。
pub fn write_book(
    books_dir: impl AsRef<Path>,
    input: &BookInput,
    existing_ids: &HashSet<String>,
) -> std::io::Result<Book> {
    let id = make_base_id(existing_ids.iter().map(String::as_str));
    let now = now_iso();
    let book = Book {
        id,
        title: input.title.clone(),
        kind: input.kind,
        author: input.author.clone(),
        country: input.country.clone(),
        year: input.year,
        translator: input.translator.clone(),
        status: input.status,
        read_count: 1,
        progress: normalize_progress_input(input.progress.as_ref()),
        collapsed: input.collapsed,
        created: now.clone(),
        updated: now,
        tags: input.tags.clone().unwrap_or_default(),
        notes: input.notes.clone(),
        starring: input.starring.clone(),
        screenwriter: input.screenwriter.clone(),
        seasons: input.seasons.clone().filter(|v| !v.is_empty()),
        episodes: None,
        // characters 不在 BookInput 里;详情页独占编辑;新建作品时为空
        characters: None,
        // next_season_id 新建作品时为空(详情页独占编辑;v1.6 起)
        next_season_id: None,
    };
    persist(&books_dir, &book)?;
    Ok(book)
}

/// 更新一本书,保留 created,刷新 updated。
pub fn update_book(
    books_dir: impl AsRef<Path>,
    id: &str,
    patch: &BookPatch,
) -> std::io::Result<Book> {
    let existing = read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;

    let mut merged = existing;
    if let Some(v) = &patch.title { merged.title = v.clone(); }
    if let Some(v) = patch.kind { merged.kind = v; }
    if let Some(v) = &patch.author { merged.author = v.clone(); }
    if let Some(v) = &patch.country { merged.country = v.clone(); }
    if let Some(v) = patch.year { merged.year = v; }
    if let Some(v) = &patch.translator { merged.translator = v.clone(); }
    if let Some(v) = patch.status { merged.status = v; }
    if let Some(v) = patch.read_count { merged.read_count = v; }
    if let Some(v) = &patch.tags { merged.tags = v.clone(); }
    if let Some(v) = patch.collapsed { merged.collapsed = v; }
    // notes: `None` = 不改,`Some("")` = 清空,`Some(s)` = 写为 s
    if let Some(v) = &patch.notes { merged.notes = v.clone(); }
    // starring 同 notes
    if let Some(v) = &patch.starring { merged.starring = v.clone(); }
    // screenwriter 同 starring
    if let Some(v) = &patch.screenwriter { merged.screenwriter = v.clone(); }
    // progress 三态:
    // - patch.progress = None → 不改
    // - patch.progress = Some(None) → 清空
    // - patch.progress = Some(Some(p)) → 设为 p(用 normalize 规整)
    if let Some(prog_opt) = &patch.progress {
        merged.progress = match prog_opt {
            None => None,
            Some(p) => normalize_progress_input(Some(p)),
        };
    }
    // seasons: None = 不改;Some(empty) = 清空(等同 None);Some(non_empty) = 替换
    if let Some(v) = &patch.seasons {
        merged.seasons = if v.is_empty() { None } else { Some(v.clone()) };
    }
    // episodes 同 seasons 语义
    if let Some(v) = &patch.episodes {
        merged.episodes = if v.is_empty() { None } else { Some(v.clone()) };
    }
    // characters 同 seasons 语义:None = 不改;Some(empty) = 清空;Some(non_empty) = 替换
    // 实际写盘策略由 persist 兜底:全空 / 全 name 空的 character 不写盘
    if let Some(v) = &patch.characters {
        merged.characters = if v.is_empty() { None } else { Some(v.clone()) };
    }
    merged.updated = now_iso();

    persist(&books_dir, &merged)?;
    Ok(merged)
}

/// 快速调整 progress.current。书不存在 → 抛错。
pub fn bump_progress(books_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Book> {
    let existing = read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let next = bump_progress_helper(existing.progress.as_ref(), delta);
    let mut patch = BookPatch::default();
    patch.progress = Some(Some(next));
    update_book(&books_dir, id, &patch)
}

/// 删除一本书。
pub fn delete_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    let path = books_dir.as_ref().join(format!("{id}.md"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// 把 book 的 frontmatter 序列化 + 原子写到 `<id>.md`(覆盖现有文件)。
/// 内部辅助函数:被 `write_book` / `update_book` / `set_seasons` / `set_episode_*` 等业务层调用。
/// v1.6 起改为 `pub(crate)` —— `service::books::set_next_season` 需要直接调它(因为 BookPatch
/// 没有 next_season_id 字段,走通用 update_book patch 路径无法更新这个字段;
/// 走专用 IPC 直接 read → 改 merged.next_season_id → persist)。
/// 其他业务方法仍走 update_book 路径(用 patch 合并 + persist)。
pub(crate) fn persist(books_dir: impl AsRef<Path>, book: &Book) -> std::io::Result<()> {
    // body 仅保留标题 heading —— notes 在 frontmatter 里,避免 body 反复重写丢失用户旧笔记
    let body = format!("# {}\n", book.title);
    // 构造 frontmatter (serde_json::Map)
    let mut fm = serde_json::Map::new();
    fm.insert("id".into(), serde_json::Value::String(book.id.clone()));
    fm.insert("title".into(), serde_json::Value::String(book.title.clone()));
    fm.insert(
        "kind".into(),
        serde_json::Value::String(book.kind.as_str().to_string()),
    );
    fm.insert("author".into(), serde_json::Value::String(book.author.clone()));
    fm.insert("country".into(), serde_json::Value::String(book.country.clone()));
    fm.insert("year".into(), serde_json::Value::Number(book.year.into()));
    fm.insert("translator".into(), serde_json::Value::String(book.translator.clone()));
    fm.insert(
        "status".into(),
        serde_json::Value::String(book.status.as_str().to_string()),
    );
    fm.insert(
        "read_count".into(),
        serde_json::Value::Number(book.read_count.into()),
    );
    fm.insert(
        "created".into(),
        serde_json::Value::String(book.created.clone()),
    );
    fm.insert(
        "updated".into(),
        serde_json::Value::String(book.updated.clone()),
    );
    fm.insert(
        "tags".into(),
        serde_json::Value::Array(
            book.tags.iter().cloned().map(serde_json::Value::String).collect(),
        ),
    );
    // notes 仅在非空时写盘 —— 空串视为"无笔记",避免污染 frontmatter
    if !book.notes.is_empty() {
        fm.insert("notes".into(), serde_json::Value::String(book.notes.clone()));
    }
    // starring 同 notes
    if !book.starring.is_empty() {
        fm.insert("starring".into(), serde_json::Value::String(book.starring.clone()));
    }
    // screenwriter 同 starring
    if !book.screenwriter.is_empty() {
        fm.insert("screenwriter".into(), serde_json::Value::String(book.screenwriter.clone()));
    }
    // collapsed 仅在 true 时写盘（与 progress / deadline 同款，避免污染 frontmatter）
    if book.collapsed {
        fm.insert("collapsed".into(), serde_json::Value::Bool(true));
    }
    if let Some(p) = &book.progress {
        let mut prog_map = serde_json::Map::new();
        prog_map.insert("current".into(), serde_json::Value::Number(p.current.into()));
        if let Some(t) = p.total {
            prog_map.insert("total".into(), serde_json::Value::Number(t.into()));
        }
        fm.insert("progress".into(), serde_json::Value::Object(prog_map));
    }
    // seasons: 仅在 Some(non_empty) 时写盘;空数组视为 None,稀疏策略
    if let Some(seasons) = &book.seasons {
        if !seasons.is_empty() {
            let arr: Vec<serde_json::Value> = seasons
                .iter()
                .map(|s| {
                    let mut obj = serde_json::Map::new();
                    obj.insert("number".into(), serde_json::Value::Number(s.number.into()));
                    obj.insert(
                        "episodeCount".into(),
                        serde_json::Value::Number(s.episode_count.into()),
                    );
                    // 季笔记:空串不写(同 notes 策略)
                    if let Some(notes) = &s.notes {
                        if !notes.is_empty() {
                            obj.insert("notes".into(), serde_json::Value::String(notes.clone()));
                        }
                    }
                    // last_modified:Some(非 0) 才写;None / 0 视为无
                    if let Some(ts) = s.last_modified {
                        if ts > 0 {
                            obj.insert("lastModified".into(), serde_json::Value::Number(ts.into()));
                        }
                    }
                    serde_json::Value::Object(obj)
                })
                .collect();
            fm.insert("seasons".into(), serde_json::Value::Array(arr));
        }
    }
    // episodes: 仅在 Some(non_empty) 时写盘;key 是 'season-episode' 字符串,内嵌 watched/note/title/stamps
    if let Some(episodes) = &book.episodes {
        if !episodes.is_empty() {
            let mut obj = serde_json::Map::new();
            for (k, rec) in episodes {
                let mut rec_obj = serde_json::Map::new();
                rec_obj.insert("watched".into(), serde_json::Value::Bool(rec.watched));
                // note:空串不写(决策 4 = 最稀疏,等同删 key —— 但此处保留 watched 时仍需写 key)
                if !rec.note.is_empty() {
                    rec_obj.insert("note".into(), serde_json::Value::String(rec.note.clone()));
                }
                // title:空串 / None 不写
                if let Some(title) = &rec.title {
                    if !title.is_empty() {
                        rec_obj.insert("title".into(), serde_json::Value::String(title.clone()));
                    }
                }
                // stamps: 仅在 Some(non_empty) 时写盘;每个 stamp 序列化 id/start/end/note
                // (end 和 空 note 也写 —— note 允许"这一帧的吐槽",end 允许 null 单时间点)
                if let Some(stamps) = &rec.stamps {
                    if !stamps.is_empty() {
                        let arr: Vec<serde_json::Value> = stamps
                            .iter()
                            .map(|s| {
                                let mut s_obj = serde_json::Map::new();
                                s_obj.insert("id".into(), serde_json::Value::String(s.id.clone()));
                                s_obj.insert("start".into(), serde_json::Value::Number(s.start.into()));
                                if let Some(end) = s.end {
                                    s_obj.insert("end".into(), serde_json::Value::Number(end.into()));
                                }
                                // note 允许空串(保留字段,语义 = "有时间戳无笔记")
                                s_obj.insert("note".into(), serde_json::Value::String(s.note.clone()));
                                serde_json::Value::Object(s_obj)
                            })
                            .collect();
                        rec_obj.insert("stamps".into(), serde_json::Value::Array(arr));
                    }
                }
                // last_modified:Some(非 0) 才写;None / 0 视为无(向后兼容老数据)
                if let Some(ts) = rec.last_modified {
                    if ts > 0 {
                        rec_obj.insert("lastModified".into(), serde_json::Value::Number(ts.into()));
                    }
                }
                obj.insert(k.clone(), serde_json::Value::Object(rec_obj));
            }
            fm.insert("episodes".into(), serde_json::Value::Object(obj));
        }
    }
    // characters: 仅在 Some(non_empty) 时写盘;v1.5 新增
    // 稀疏策略:整条 character 的 name 空 → 跳过该条;notes 空 → 不写 notes 字段
    // last_modified:Some(非 0) 才写;None / 0 视为无
    if let Some(chars) = &book.characters {
        let filtered: Vec<&Character> = chars.iter().filter(|c| !c.name.is_empty()).collect();
        if !filtered.is_empty() {
            let arr: Vec<serde_json::Value> = filtered
                .into_iter()
                .map(|c| {
                    let mut obj = serde_json::Map::new();
                    obj.insert("id".into(), serde_json::Value::String(c.id.clone()));
                    obj.insert("name".into(), serde_json::Value::String(c.name.clone()));
                    // notes: 空串不写(保留 character 实体)
                    if let Some(notes) = &c.notes {
                        if !notes.is_empty() {
                            obj.insert("notes".into(), serde_json::Value::String(notes.clone()));
                        }
                    }
                    // last_modified:Some(非 0) 才写
                    if let Some(ts) = c.last_modified {
                        if ts > 0 {
                            obj.insert("lastModified".into(), serde_json::Value::Number(ts.into()));
                        }
                    }
                    serde_json::Value::Object(obj)
                })
                .collect();
            fm.insert("characters".into(), serde_json::Value::Array(arr));
        }
    }
    // next_season_id: 仅在 Some(非空) 时写盘(v1.6 新增;跟 notes / starring 同款"空串不写"策略)
    // 老文件缺字段 → None(向后兼容,parse 阶段 serde(default) 兜底)
    if let Some(nid) = &book.next_season_id {
        if !nid.is_empty() {
            fm.insert("nextSeasonId".into(), serde_json::Value::String(nid.clone()));
        }
    }

    let front = serde_json::to_string_pretty(&serde_json::Value::Object(fm))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    // front 末尾无换行,需要手动加,否则 `}---` 会粘成一行
    let content = format!("---\n{front}\n---\n{body}");

    let path = books_dir.as_ref().join(format!("{}.md", book.id));
    atomic_write_file(&path, &content)
}

// 实现 status <-> str 转换(供 frontmatter 序列化)
impl BookStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            BookStatus::Want => "want",
            BookStatus::Shelved => "shelved",
            BookStatus::Reading => "reading",
            BookStatus::Watching => "watching",
            BookStatus::Finished => "finished",
            BookStatus::Abandoned => "abandoned",
        }
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Progress, WorkKind};

    fn temp_books_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        ensure_dir(dir.path().join("books")).unwrap();
        dir
    }

    fn sample_input() -> BookInput {
        BookInput {
            title: "百年孤独".to_string(),
            kind: WorkKind::Book,
            author: "加西亚·马尔克斯".to_string(),
            country: "哥伦比亚".to_string(),
            year: 1967,
            translator: "范晔".to_string(),
            status: BookStatus::Reading,
            progress: Some(Progress { current: 12, total: Some(100) }),
            tags: Some(vec!["小说".to_string()]),
            collapsed: false,
            notes: String::new(),
            starring: String::new(),
            screenwriter: String::new(),
            seasons: None,
        }
    }

    #[test]
    fn make_base_id_then_write_then_read_round_trip() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let input = sample_input();
        let existing = HashSet::new();
        let book = write_book(&books_dir, &input, &existing).unwrap();
        assert_eq!(book.id, "1");

        let read_back = read_book(&books_dir, "1").unwrap().unwrap();
        assert_eq!(read_back.id, "1");
        assert_eq!(read_back.title, "百年孤独");
        assert_eq!(read_back.author, "加西亚·马尔克斯");
        assert_eq!(read_back.year, 1967);
        assert_eq!(read_back.status, BookStatus::Reading);
        assert_eq!(read_back.progress.as_ref().unwrap().current, 12);
        assert_eq!(read_back.progress.as_ref().unwrap().total, Some(100));
        assert_eq!(read_back.tags, vec!["小说".to_string()]);
        // created == updated
        assert_eq!(read_back.created, read_back.updated);
    }

    #[test]
    fn second_write_uses_next_id() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let existing = HashSet::new();
        let b1 = write_book(&books_dir, &sample_input(), &existing).unwrap();
        let existing: HashSet<String> = std::iter::once(b1.id.clone()).collect();
        let b2 = write_book(&books_dir, &sample_input(), &existing).unwrap();
        assert_eq!(b2.id, "2");
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = temp_books_dir();
        let got = read_book(dir.path().join("books"), "nope").unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn broken_file_is_reported() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        std::fs::write(
            books_dir.join("bad.md"),
            "---\nstatus: invalid_status\n---\n# x\n",
        )
        .unwrap();
        let result = read_all_books(&books_dir).unwrap();
        assert!(result.books.is_empty());
        assert_eq!(result.broken.len(), 1);
        assert_eq!(result.broken[0].id, "bad");
    }

    #[test]
    fn update_book_partial_patch() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let created_before = book.created.clone();

        // 等 1 秒确保 updated 时间戳不同(ISO 8601 是秒级精度)
        std::thread::sleep(std::time::Duration::from_secs(1));
        let patch = BookPatch {
            status: Some(BookStatus::Finished),
            ..Default::default()
        };
        let updated = update_book(&books_dir, &book.id, &patch).unwrap();
        assert_eq!(updated.status, BookStatus::Finished);
        assert_eq!(updated.created, created_before);
        assert_ne!(updated.updated, created_before); // updated 刷新了
        assert_eq!(updated.title, "百年孤独"); // 未修改
    }

    #[test]
    fn update_book_clear_progress_via_some_none() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        assert!(book.progress.is_some());

        let patch = BookPatch {
            progress: Some(None),
            ..Default::default()
        };
        let updated = update_book(&books_dir, &book.id, &patch).unwrap();
        assert!(updated.progress.is_none());
    }

    #[test]
    fn update_book_no_change_when_patch_empty() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let created = book.created.clone();

        // 等待至少 1 秒保证 updated 时间戳不同
        std::thread::sleep(std::time::Duration::from_secs(1));
        let updated = update_book(&books_dir, &book.id, &BookPatch::default()).unwrap();
        assert_eq!(updated.title, book.title);
        assert_eq!(updated.created, created);
        // updated 仍然刷新
        assert_ne!(updated.updated, created);
    }

    #[test]
    fn bump_progress_increments() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let bumped = bump_progress(&books_dir, &book.id, 5).unwrap();
        assert_eq!(bumped.progress.as_ref().unwrap().current, 17);
    }

    #[test]
    fn bump_progress_initializes_from_null() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let mut input = sample_input();
        input.progress = None;
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert!(book.progress.is_none());

        let bumped = bump_progress(&books_dir, &book.id, 1).unwrap();
        assert_eq!(bumped.progress.as_ref().unwrap().current, 1);
        assert!(bumped.progress.as_ref().unwrap().total.is_none());
    }

    #[test]
    fn delete_book_removes_file() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        assert!(books_dir.join(format!("{}.md", book.id)).exists());
        delete_book(&books_dir, &book.id).unwrap();
        assert!(!books_dir.join(format!("{}.md", book.id)).exists());
    }

    #[test]
    fn delete_missing_book_is_ok() {
        let dir = temp_books_dir();
        delete_book(dir.path().join("books"), "never-existed").unwrap();
    }

    /// watching 状态（"在看"）与 reading 语义一致 —— 是新增的「进行中」状态,
    /// UI 仅在非电影类型表单中暴露,但 Rust 端序列化/反序列化对所有类型都接受。
    /// 旧的 .md 文件即使存了 "watching" 也能正常读回（防止未来用户改 frontmatter 时崩）。
    #[test]
    fn watching_status_round_trip_and_validation() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) round-trip:写盘 watching → 读回 watching
        let mut input = sample_input();
        input.status = BookStatus::Watching;
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert_eq!(book.status, BookStatus::Watching);
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"status\": \"watching\""), "frontmatter should contain watching");
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        assert_eq!(read_back.status, BookStatus::Watching);

        // 2) as_str 映射正确
        assert_eq!(BookStatus::Watching.as_str(), "watching");

        // 3) patch.status = Some(Watching) → 合并生效
        let mut input2 = sample_input();
        input2.status = BookStatus::Reading;
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let patch = BookPatch { status: Some(BookStatus::Watching), ..Default::default() };
        let updated = update_book(&books_dir, &book2.id, &patch).unwrap();
        assert_eq!(updated.status, BookStatus::Watching);
    }

    /// notes 字段写盘 / 读回 / patch 合并 / 空串不写盘 的回归测试。
    /// 不变量:
    /// - `notes: "..."`（非空）写盘到 frontmatter,读回一致
    /// - `notes: ""`（空串）不写盘(避免污染 frontmatter);读回为 ""
    /// - 老文件缺 `notes` 字段 → 读回为 ""（向后兼容）
    /// - patch.notes = None 不改;Some("") 清空;Some(s) 写为 s
    #[test]
    fn notes_round_trip_and_omit_when_empty() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 非空 notes 写盘 + 读回
        let mut input = sample_input();
        input.notes = "第一行笔记\n第二行笔记\n第三行".to_string();
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"notes\""), "notes 应写盘");
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        assert_eq!(read_back.notes, "第一行笔记\n第二行笔记\n第三行");

        // 2) 空 notes 不写盘
        let mut input2 = sample_input();
        input2.notes = String::new();
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw2.contains("notes"), "空 notes 不应写盘");
        assert_eq!(read_book(&books_dir, &book2.id).unwrap().unwrap().notes, "");

        // 3) 老文件缺 notes 字段 → 读回为 ""
        let legacy = books_dir.join("77.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"77\",\"title\":\"老书\",\"status\":\"finished\"}\n---\n# 老书\n",
        )
        .unwrap();
        assert_eq!(read_book(&books_dir, "77").unwrap().unwrap().notes, "");

        // 4) patch 合并:None 不改,Some("") 清空,Some(s) 写为 s
        let book3 = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert_eq!(book3.notes, "第一行笔记\n第二行笔记\n第三行");
        // patch.notes = None → 不改
        let patch_none = BookPatch { ..Default::default() };
        let updated = update_book(&books_dir, &book3.id, &patch_none).unwrap();
        assert_eq!(updated.notes, "第一行笔记\n第二行笔记\n第三行");
        // patch.notes = Some("") → 清空
        let patch_clear = BookPatch { notes: Some(String::new()), ..Default::default() };
        let cleared = update_book(&books_dir, &book3.id, &patch_clear).unwrap();
        assert_eq!(cleared.notes, "");
        // patch.notes = Some("新笔记") → 写为新内容
        let patch_set = BookPatch { notes: Some("新笔记".to_string()), ..Default::default() };
        let set = update_book(&books_dir, &book3.id, &patch_set).unwrap();
        assert_eq!(set.notes, "新笔记");
    }

    /// starring(主演)字段写盘 / 读回 / patch 合并 / 空串不写盘 的回归测试。
    /// 与 notes 共享同一策略 —— 验证影视类型(movie/tv)的"主演"字段不污染 frontmatter。
    #[test]
    fn starring_round_trip_and_omit_when_empty() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 非空 starring 写盘 + 读回
        let mut input = sample_input();
        input.kind = WorkKind::Movie;
        input.starring = "基努·里维斯, 劳伦斯·菲什伯恩".to_string();
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"starring\""), "starring 应写盘");
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        assert_eq!(read_back.starring, "基努·里维斯, 劳伦斯·菲什伯恩");

        // 2) 空 starring 不写盘
        let mut input2 = sample_input();
        input2.kind = WorkKind::Movie;
        input2.starring = String::new();
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw2.contains("starring"), "空 starring 不应写盘");
        assert_eq!(read_book(&books_dir, &book2.id).unwrap().unwrap().starring, "");

        // 3) 老文件缺 starring 字段 → 读回为 ""
        let legacy = books_dir.join("88.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"88\",\"title\":\"老影视\",\"status\":\"finished\",\"kind\":\"movie\"}\n---\n# 老影视\n",
        )
        .unwrap();
        assert_eq!(read_book(&books_dir, "88").unwrap().unwrap().starring, "");

        // 4) patch 合并:None 不改,Some("") 清空,Some(s) 写为 s
        let book3 = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert_eq!(book3.starring, "基努·里维斯, 劳伦斯·菲什伯恩");
        let patch_none = BookPatch { ..Default::default() };
        let updated = update_book(&books_dir, &book3.id, &patch_none).unwrap();
        assert_eq!(updated.starring, "基努·里维斯, 劳伦斯·菲什伯恩");
        let patch_clear = BookPatch { starring: Some(String::new()), ..Default::default() };
        let cleared = update_book(&books_dir, &book3.id, &patch_clear).unwrap();
        assert_eq!(cleared.starring, "");
        let patch_set = BookPatch { starring: Some("新主演".to_string()), ..Default::default() };
        let set = update_book(&books_dir, &book3.id, &patch_set).unwrap();
        assert_eq!(set.starring, "新主演");
    }

    /// screenwriter(编剧)字段写盘 / 读回 / patch 合并 / 空串不写盘 的回归测试。
    /// 与 starring 共享同一策略 —— 验证影视类型(movie/tv)的"编剧"字段不污染 frontmatter。
    #[test]
    fn screenwriter_round_trip_and_omit_when_empty() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 非空 screenwriter 写盘 + 读回
        let mut input = sample_input();
        input.kind = WorkKind::Movie;
        input.screenwriter = "诺兰, 乔纳森·诺兰".to_string();
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"screenwriter\""), "screenwriter 应写盘");
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        assert_eq!(read_back.screenwriter, "诺兰, 乔纳森·诺兰");

        // 2) 空 screenwriter 不写盘
        let mut input2 = sample_input();
        input2.kind = WorkKind::Movie;
        input2.screenwriter = String::new();
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw2.contains("screenwriter"), "空 screenwriter 不应写盘");
        assert_eq!(read_book(&books_dir, &book2.id).unwrap().unwrap().screenwriter, "");

        // 3) 老文件缺 screenwriter 字段 → 读回为 ""
        let legacy = books_dir.join("89.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"89\",\"title\":\"老影视\",\"status\":\"finished\",\"kind\":\"movie\"}\n---\n# 老影视\n",
        )
        .unwrap();
        assert_eq!(read_book(&books_dir, "89").unwrap().unwrap().screenwriter, "");

        // 4) patch 合并:None 不改,Some("") 清空,Some(s) 写为 s
        let book3 = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert_eq!(book3.screenwriter, "诺兰, 乔纳森·诺兰");
        let patch_none = BookPatch { ..Default::default() };
        let updated = update_book(&books_dir, &book3.id, &patch_none).unwrap();
        assert_eq!(updated.screenwriter, "诺兰, 乔纳森·诺兰");
        let patch_clear = BookPatch { screenwriter: Some(String::new()), ..Default::default() };
        let cleared = update_book(&books_dir, &book3.id, &patch_clear).unwrap();
        assert_eq!(cleared.screenwriter, "");
        let patch_set = BookPatch { screenwriter: Some("新编剧".to_string()), ..Default::default() };
        let set = update_book(&books_dir, &book3.id, &patch_set).unwrap();
        assert_eq!(set.screenwriter, "新编剧");
    }

    #[test]
    fn progress_field_absent_in_frontmatter_when_none() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");
        let mut input = sample_input();
        input.progress = None;
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        // 没 progress 字段时不应出现 "progress:"
        assert!(!raw.contains("progress:"), "frontmatter leaked empty progress field");
    }

    #[test]
    fn kind_round_trip_and_legacy_default() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // anime 类型写盘 → 读回一致
        let mut input = sample_input();
        input.kind = WorkKind::Anime;
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"kind\": \"anime\""));
        assert_eq!(read_book(&books_dir, &book.id).unwrap().unwrap().kind, WorkKind::Anime);

        // 旧文件没有 kind 字段 → 默认 Book
        let legacy = books_dir.join("99.md");
        std::fs::write(&legacy, "---\n{\"id\":\"99\",\"title\":\"旧书\",\"status\":\"finished\"}\n---\n# 旧书\n").unwrap();
        assert_eq!(read_book(&books_dir, "99").unwrap().unwrap().kind, WorkKind::Book);

        // patch.kind 合并
        let patch = BookPatch { kind: Some(WorkKind::Movie), ..Default::default() };
        let updated = update_book(&books_dir, &book.id, &patch).unwrap();
        assert_eq!(updated.kind, WorkKind::Movie);
    }

    #[test]
    fn collapsed_round_trip_and_omit_when_false() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // collapsed=true → 写盘并读回
        let mut input = sample_input();
        input.collapsed = true;
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        assert!(book.collapsed);
        let raw_true = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw_true.contains("\"collapsed\": true"), "collapsed=true 应写盘");
        assert!(read_book(&books_dir, &book.id).unwrap().unwrap().collapsed);

        // collapsed=false → 不写盘，读回仍为 false
        let mut input2 = sample_input();
        input2.collapsed = false;
        let ids: HashSet<String> = [book.id.clone()].into_iter().collect();
        let book2 = write_book(&books_dir, &input2, &ids).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw.contains("collapsed"), "collapsed=false 不应写盘");
        assert!(!read_book(&books_dir, &book2.id).unwrap().unwrap().collapsed);

        // 旧文件没有 collapsed 字段 → 默认 false（向后兼容）
        let legacy = books_dir.join("98.md");
        std::fs::write(&legacy, "---\n{\"id\":\"98\",\"title\":\"旧书2\",\"status\":\"finished\"}\n---\n# 旧书2\n").unwrap();
        assert!(!read_book(&books_dir, "98").unwrap().unwrap().collapsed);

        // patch.collapsed 只在该字段出现时合并（true / false 都要生效）
        let patch_true = BookPatch { collapsed: Some(true), ..Default::default() };
        let updated = update_book(&books_dir, &book.id, &patch_true).unwrap();
        assert!(updated.collapsed);
        let patch_false = BookPatch { collapsed: Some(false), ..Default::default() };
        let updated2 = update_book(&books_dir, &book.id, &patch_false).unwrap();
        assert!(!updated2.collapsed);

        // 关键不变量：collapsed 不影响 status / read_count（正交语义）
        let mut input3 = sample_input();
        input3.status = BookStatus::Finished;
        input3.collapsed = true;
        let b3 = write_book(&books_dir, &input3, &HashSet::new()).unwrap();
        assert_eq!(b3.status, BookStatus::Finished);
        assert!(b3.collapsed);
    }

    /// EpisodeRecord.stamps 字段(v1.3 时间戳笔记)的回归测试。
    /// 不变量:
    /// - stamps 非空 → 写盘;读回时按 start 升序排序(同 start 按 id 字典序)
    /// - stamps 为空数组 / None → 不写字段;读回 None(最稀疏策略)
    /// - 老文件缺 stamps 字段 → 读回 None(向后兼容,容错)
    /// - stamps 内单条字段缺损(id / start / note) → 跳过该条(避免坏数据整本不可读)
    /// - end 字段缺损 / null → 读回 None(单时间点);end 非 null → 读回 Some(时间段)
    /// - persist 期间保证稳定排序(同一 id 写两次顺序不变)
    #[test]
    fn episode_stamps_round_trip_and_omit_when_empty() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 写入带 stamps 的 book → 读回顺序按 start 升序
        let mut input = sample_input();
        input.kind = WorkKind::Tv;
        input.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 3, notes: None, last_modified: None }]);
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        // 走 episode_bump 路径把第 1 集标 watched(用 patch 直接构造更直接)
        let mut eps = EpisodeNotes::new();
        eps.insert(
            "1-1".to_string(),
            EpisodeRecord {
                watched: true,
                note: String::new(),
                title: None,
                stamps: Some(vec![
                    TimeStamp {
                        id: "id-002".to_string(),
                        start: 1945,
                        end: Some(2200),
                        note: "追车".to_string(),
                    },
                    TimeStamp {
                        id: "id-001".to_string(),
                        start: 100,
                        end: None,
                        note: "开场".to_string(),
                    },
                    TimeStamp {
                        id: "id-003".to_string(),
                        start: 5000,
                        end: Some(5500),
                        note: "高潮".to_string(),
                    },
                ]),
                last_modified: None,
            },
        );
        let patch = BookPatch { episodes: Some(eps), ..Default::default() };
        update_book(&books_dir, &book.id, &patch).unwrap();
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        let stamps = read_back
            .episodes
            .as_ref()
            .unwrap()
            .get("1-1")
            .unwrap()
            .stamps
            .as_ref()
            .unwrap();
        assert_eq!(stamps.len(), 3);
        // 顺序应是 start 升序:100 / 1945 / 5000
        assert_eq!(stamps[0].id, "id-001");
        assert_eq!(stamps[0].start, 100);
        assert_eq!(stamps[0].end, None);
        assert_eq!(stamps[0].note, "开场");
        assert_eq!(stamps[1].id, "id-002");
        assert_eq!(stamps[1].start, 1945);
        assert_eq!(stamps[1].end, Some(2200));
        assert_eq!(stamps[2].id, "id-003");
        assert_eq!(stamps[2].start, 5000);
        assert_eq!(stamps[2].end, Some(5500));

        // 2) raw 文件确实写入了 stamps(数组形态)
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"stamps\""), "stamps 应写盘");
        assert!(raw.contains("\"id\": \"id-001\""), "stamp id 应写盘");
        assert!(raw.contains("\"start\": 100"), "stamp start 应写盘");
        assert!(raw.contains("\"end\": 2200"), "stamp end 应写盘");

        // 3) stamps 空数组 → 不写盘,读回 None
        let mut input2 = sample_input();
        input2.kind = WorkKind::Tv;
        input2.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 2, notes: None, last_modified: None }]);
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let mut eps2 = EpisodeNotes::new();
        eps2.insert(
            "1-1".to_string(),
            EpisodeRecord { watched: false, note: String::new(), title: None, stamps: Some(vec![]), last_modified: None },
        );
        let patch = BookPatch { episodes: Some(eps2), ..Default::default() };
        update_book(&books_dir, &book2.id, &patch).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw2.contains("stamps"), "空 stamps 数组不应写盘");
        let read2 = read_book(&books_dir, &book2.id).unwrap().unwrap();
        assert!(read2.episodes.as_ref().unwrap().get("1-1").unwrap().stamps.is_none());

        // 4) 老文件缺 stamps 字段 → 读回 None(向后兼容)
        let legacy = books_dir.join("legacy-tv.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"legacy-tv\",\"title\":\"老剧\",\"status\":\"finished\",\"kind\":\"tv\",\"episodes\":{\"1-1\":{\"watched\":true,\"note\":\"老笔记\"}}}\n---\n# 老剧\n",
        )
        .unwrap();
        let legacy_book = read_book(&books_dir, "legacy-tv").unwrap().unwrap();
        let legacy_ep = legacy_book.episodes.as_ref().unwrap().get("1-1").unwrap();
        assert!(legacy_ep.stamps.is_none(), "老文件缺 stamps 字段应读回 None");

        // 5) 缺 id / start 字段的 stamp → 跳过(整本仍可读)
        let mut input3 = sample_input();
        input3.kind = WorkKind::Tv;
        input3.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 1, notes: None, last_modified: None }]);
        let book3 = write_book(&books_dir, &input3, &HashSet::new()).unwrap();
        // 直接写 frontmatter 含坏 stamp
        std::fs::write(
            books_dir.join(format!("{}.md", book3.id)),
            "---\n{\"id\":\"100\",\"title\":\"测试\",\"status\":\"finished\",\"kind\":\"tv\",\"episodes\":{\"1-1\":{\"watched\":true,\"note\":\"x\",\"stamps\":[{\"start\":10,\"note\":\"缺id\"},{\"id\":\"ok\",\"start\":5,\"note\":\"完整\"}]}}}\n---\n# 测试\n",
        ).unwrap();
        let broken_read = read_book(&books_dir, &book3.id).unwrap().unwrap();
        let broken_stamps = broken_read
            .episodes
            .as_ref()
            .unwrap()
            .get("1-1")
            .unwrap()
            .stamps
            .as_ref()
            .unwrap();
        // 只剩完整那条
        assert_eq!(broken_stamps.len(), 1);
        assert_eq!(broken_stamps[0].id, "ok");
        assert_eq!(broken_stamps[0].start, 5);

        // 6) 稳定排序:同 start 按 id 字典序(防止持久化后两次读不一致)
        let mut input4 = sample_input();
        input4.kind = WorkKind::Tv;
        input4.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 1, notes: None, last_modified: None }]);
        let book4 = write_book(&books_dir, &input4, &HashSet::new()).unwrap();
        let mut eps4 = EpisodeNotes::new();
        eps4.insert(
            "1-1".to_string(),
            EpisodeRecord {
                watched: true,
                note: String::new(),
                title: None,
                stamps: Some(vec![
                    TimeStamp { id: "z-id".to_string(), start: 100, end: None, note: "Z".to_string() },
                    TimeStamp { id: "a-id".to_string(), start: 100, end: None, note: "A".to_string() },
                    TimeStamp { id: "m-id".to_string(), start: 100, end: None, note: "M".to_string() },
                ]),
                last_modified: None,
            },
        );
        let patch = BookPatch { episodes: Some(eps4), ..Default::default() };
        update_book(&books_dir, &book4.id, &patch).unwrap();
        let sorted = read_book(&books_dir, &book4.id).unwrap().unwrap();
        let stamps_sorted = sorted.episodes.as_ref().unwrap().get("1-1").unwrap().stamps.as_ref().unwrap();
        // 同 start → 按 id 字典序:a-id / m-id / z-id
        assert_eq!(stamps_sorted[0].id, "a-id");
        assert_eq!(stamps_sorted[1].id, "m-id");
        assert_eq!(stamps_sorted[2].id, "z-id");
    }

    /// v1.5 角色笔记 + lastModified 字段的回归测试。
    /// 不变量:
    /// - Character 数组非空 → 写盘;读回顺序保持(用户主动 add 顺序)
    /// - 空数组 / 全 name 空 → 不写 characters 字段
    /// - 单条 character name 空 → 写盘时跳过该条(兜底过滤)
    /// - 单条 character notes 空 → 不写 notes 字段(保留 character)
    /// - lastModified:Some(非 0) 写盘;None / 0 不写
    /// - 老文件缺 characters 字段 → 读回 None(向后兼容)
    /// - 老文件缺 EpisodeRecord.lastModified 字段 → 读回 None
    #[test]
    fn characters_round_trip_and_sparse() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 写两条 character(带 notes + lastModified),读回顺序保持
        let book = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let chars = vec![
            Character {
                id: "c-001".to_string(),
                name: "高育良".to_string(),
                notes: Some("汉东省委副书记".to_string()),
                last_modified: Some(1_700_000_000_000),
            },
            Character {
                id: "c-002".to_string(),
                name: "侯亮平".to_string(),
                notes: None, // notes 空 → 不写
                last_modified: Some(1_700_000_500_000),
            },
        ];
        let patch = BookPatch { characters: Some(chars.clone()), ..Default::default() };
        update_book(&books_dir, &book.id, &patch).unwrap();

        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"characters\""), "characters 应写盘");
        assert!(raw.contains("\"高育良\""), "第一条 name 应写盘");
        assert!(raw.contains("\"汉东省委副书记\""), "第一条 notes 应写盘");
        assert!(raw.contains("\"lastModified\": 1700000000000"), "lastModified 应写盘(毫秒整数)");
        assert!(!raw.contains("\"notes\":\"\""), "空 notes 不应写盘");
        // 顺序:add 顺序
        let read_back = read_book(&books_dir, &book.id).unwrap().unwrap();
        let read_chars = read_back.characters.as_ref().unwrap();
        assert_eq!(read_chars.len(), 2);
        assert_eq!(read_chars[0].id, "c-001");
        assert_eq!(read_chars[0].name, "高育良");
        assert_eq!(read_chars[0].notes.as_deref(), Some("汉东省委副书记"));
        assert_eq!(read_chars[0].last_modified, Some(1_700_000_000_000));
        assert_eq!(read_chars[1].id, "c-002");
        assert_eq!(read_chars[1].name, "侯亮平");
        assert!(read_chars[1].notes.is_none());
        assert_eq!(read_chars[1].last_modified, Some(1_700_000_500_000));

        // 2) 全空数组 → 不写盘
        let book2 = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let patch_empty = BookPatch { characters: Some(vec![]), ..Default::default() };
        update_book(&books_dir, &book2.id, &patch_empty).unwrap();
        let raw_empty = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw_empty.contains("characters"), "空数组不应写 characters 字段");
        let read_empty = read_book(&books_dir, &book2.id).unwrap().unwrap();
        assert!(read_empty.characters.is_none());

        // 3) 含 name 空的 character → 写盘时跳过该条(兜底)
        let book3 = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let bad_chars = vec![
            Character { id: "c-bad".to_string(), name: String::new(), notes: None, last_modified: None },
            Character { id: "c-good".to_string(), name: "沙瑞金".to_string(), notes: Some("汉东省委书记".to_string()), last_modified: Some(1_700_000_000_000) },
        ];
        let patch = BookPatch { characters: Some(bad_chars), ..Default::default() };
        update_book(&books_dir, &book3.id, &patch).unwrap();
        let read3 = read_book(&books_dir, &book3.id).unwrap().unwrap();
        let read3_chars = read3.characters.as_ref().unwrap();
        // name 空的被过滤掉,只剩 1 条
        assert_eq!(read3_chars.len(), 1);
        assert_eq!(read3_chars[0].id, "c-good");
        assert_eq!(read3_chars[0].name, "沙瑞金");

        // 4) 老文件缺 characters 字段 → 读回 None(向后兼容)
        let legacy = books_dir.join("legacy.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"legacy\",\"title\":\"老剧\",\"status\":\"finished\"}\n---\n# 老剧\n",
        ).unwrap();
        let legacy_book = read_book(&books_dir, "legacy").unwrap().unwrap();
        assert!(legacy_book.characters.is_none());
    }

    /// v1.5 EpisodeRecord.lastModified 字段的回归测试。
    /// 不变量:
    /// - Some(非 0) → 写盘;None / 0 → 不写
    /// - 老文件缺 lastModified 字段 → 读回 None(向后兼容)
    /// - 配合 set_episode_note 路径:note 非空 + last_modified 透传 → 该集 lastModified 被刷
    #[test]
    fn episode_last_modified_round_trip_and_omit() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) Some(非 0) → 写盘
        let mut input = sample_input();
        input.kind = WorkKind::Tv;
        input.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 1, notes: None, last_modified: None }]);
        let book = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let mut eps = EpisodeNotes::new();
        eps.insert(
            "1-1".to_string(),
            EpisodeRecord {
                watched: true,
                note: "笔记内容".to_string(),
                title: None,
                stamps: None,
                last_modified: Some(1_700_000_000_000),
            },
        );
        let patch = BookPatch { episodes: Some(eps), ..Default::default() };
        update_book(&books_dir, &book.id, &patch).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book.id))).unwrap();
        assert!(raw.contains("\"lastModified\": 1700000000000"), "非 0 lastModified 应写盘");

        // 2) None → 不写盘
        let mut input2 = sample_input();
        input2.kind = WorkKind::Tv;
        input2.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 1, notes: None, last_modified: None }]);
        let book2 = write_book(&books_dir, &input2, &HashSet::new()).unwrap();
        let mut eps2 = EpisodeNotes::new();
        eps2.insert(
            "1-1".to_string(),
            EpisodeRecord { watched: true, note: "x".to_string(), title: None, stamps: None, last_modified: None },
        );
        let patch = BookPatch { episodes: Some(eps2), ..Default::default() };
        update_book(&books_dir, &book2.id, &patch).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book2.id))).unwrap();
        assert!(!raw2.contains("\"lastModified\""), "None lastModified 不应写盘");

        // 3) 老文件缺 lastModified 字段 → 读回 None(向后兼容)
        let legacy = books_dir.join("legacy-ep.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"legacy-ep\",\"title\":\"老剧\",\"status\":\"finished\",\"kind\":\"tv\",\"episodes\":{\"1-1\":{\"watched\":true,\"note\":\"x\"}}}\n---\n# 老剧\n",
        ).unwrap();
        let legacy_ep = read_book(&books_dir, "legacy-ep").unwrap().unwrap();
        assert!(legacy_ep.episodes.as_ref().unwrap().get("1-1").unwrap().last_modified.is_none());
    }

    /// v1.6 Book.next_season_id 字段的回归测试。
    /// 不变量:
    /// - Some(非空) → 写盘(frontmatter `nextSeasonId`);空串视为 None 不写盘
    /// - 老文件缺 nextSeasonId 字段 → 读回 None(向后兼容)
    /// 注:set_next_season 业务方法的 self-loop 校验在 service 模块(#[cfg(not(test))]),
    /// 这里只测 data 层的 persist 写盘策略。
    #[test]
    fn next_season_id_round_trip_and_omit() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 写 book → next_season_id 默认 None,frontmatter 不写盘字段
        let mut input = sample_input();
        input.title = "S01".to_string();
        let book_a = write_book(&books_dir, &input, &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(!raw.contains("nextSeasonId"), "新建作品默认无 nextSeasonId; raw={raw}");

        // 2) 通过 set_next_season 业务方法被 cfg(not(test)) 隔离 — 这里直接模拟它的写盘逻辑:
        // read → 改 merged.next_season_id → persist → 验证
        let mut book = read_book(&books_dir, &book_a.id).unwrap().unwrap();
        book.next_season_id = Some("5".to_string());
        persist(&books_dir, &book).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(raw.contains("\"nextSeasonId\": \"5\""), "nextSeasonId 应写盘; raw={raw}");

        // 3) 空串视为 None,不写盘
        let mut book = read_book(&books_dir, &book_a.id).unwrap().unwrap();
        book.next_season_id = None; // 空串 → normalize 成 None(service 层负责)
        persist(&books_dir, &book).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(!raw.contains("nextSeasonId"), "None 不应写盘; raw={raw}");

        // 4) 老文件缺 nextSeasonId 字段 → 读回 None(向后兼容)
        let legacy = books_dir.join("legacy-next.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"legacy-next\",\"title\":\"老剧\",\"status\":\"finished\",\"kind\":\"tv\"}\n---\n# 老剧\n",
        ).unwrap();
        let legacy_book = read_book(&books_dir, "legacy-next").unwrap().unwrap();
        assert!(legacy_book.next_season_id.is_none());
    }
}
