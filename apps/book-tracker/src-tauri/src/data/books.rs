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
        // v1.6:prev_season_id —— 字段缺损 / 非字符串 / 空串 → None(向后兼容;老文件无此字段)。
        // 此字段由 service 层在 set_next_season 路径自动维护,前端可通过 books_set_prev_season 主动设。
        prev_season_id: data
            .get("prevSeasonId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        // v2.x:prev_season_explicit —— 字段缺损 / 非 bool → false（向后兼容;老数据无此字段）。
        // true = 用户主动设的 prev(set_prev_season 路径),service 层反向同步不应清掉;
        // false = service 层在 set_next_season 路径自动同步时设的(默认),可被反向清理。
        prev_season_explicit: data
            .get("prevSeasonExplicit")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        // v1.7:series_id —— 字段缺损 / 非字符串 / 空串 → None（向后兼容;老文件无此字段）。
        // 单向引用,跟 nextSeasonId / prevSeasonId 同款"空串不写盘"策略。
        series_id: data
            .get("seriesId")
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
        // lastModified(v1.6 新增):per-row 跟踪。字段缺损 / 非数字 / 0 → None(向后兼容老数据)
        let last_modified = obj
            .get("lastModified")
            .and_then(|x| x.as_u64())
            .filter(|&n| n > 0);
        stamps.push(TimeStamp {
            id: id.to_string(),
            start: start as u32,
            end,
            note,
            last_modified,
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
        // prev_season_id 同款:新建作品时为空;由 service 层在 set_next_season 路径自动维护
        // 或用户通过 books_set_prev_season 主动设
        prev_season_id: None,
        // 新建作品 prev 显然不是用户主动设的(没设过),默认 false
        prev_season_explicit: false,
        // series_id(v1.7 起):从 BookInput 透传;新建作品时可为 None(等同"无所属系列")
        series_id: input.series_id.as_ref().filter(|s| !s.is_empty()).cloned(),
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
///
/// v1.6 起连带清理指向 / 被指向的季链关联:
/// - 找到所有 `next_season_id == id` 的 book → 清掉它们自己的 next_season_id(不指向已删除的)
/// - 找到所有 `prev_season_id == id` 的 book → 清掉它们自己的 prev_season_id(无主的反向引用)
///
/// 清理是 idempotent —— 老数据没这两字段时也不报错;
/// 单向清理不做"重定向"(不会把 A→id→B 拼成 A→B),只把脏引用清掉,
/// 理由:A 用户的设置是显式的,我们不擅自重写他的指向;若 A 真指向已删的 book,让用户重设。
pub fn delete_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    let path = books_dir.as_ref().join(format!("{id}.md"));
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    // 清理指向已删 book 的关联 —— 扫所有 book,找到匹配的就 persist 清掉。
    // 用 read_all_books 走 normal 路径(跳过损坏的),用 persist 走正常写盘。
    let dir = books_dir.as_ref();
    let all = match read_all_books(dir) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    for mut book in all.books {
        let mut touched = false;
        if book.next_season_id.as_deref() == Some(id) {
            book.next_season_id = None;
            touched = true;
        }
        if book.prev_season_id.as_deref() == Some(id) {
            book.prev_season_id = None;
            touched = true;
        }
        if touched {
            // 不刷 updated —— 清理脏引用是结构性维护,不是用户主动编辑
            persist(dir, &book)?;
        }
    }
    Ok(())
}

/// 清理所有 `series_id == series_id` 的 book(把它们的 series_id 置 None)。
/// v1.7 起 —— series 删除时的脏引用清理。
///
/// **不刷 updated**(跟 delete_book 的脏引用清理同款 —— 结构性维护,不是用户主动编辑)。
/// 容错:read_all_books 失败时静默返回 Ok(避免阻塞 series 删除主流程;坏数据等下次启动再处理)。
/// 单条 book 的 persist 失败会向上抛错 —— 让上层知晓清理中断。
pub fn clear_series_references(
    books_dir: impl AsRef<Path>,
    series_id: &str,
) -> std::io::Result<()> {
    let dir = books_dir.as_ref();
    let all = match read_all_books(dir) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    for mut book in all.books {
        if book.series_id.as_deref() == Some(series_id) {
            book.series_id = None;
            // 不刷 updated —— 清理脏引用是结构性维护
            persist(dir, &book)?;
        }
    }
    Ok(())
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
                // stamps: 仅在 Some(non_empty) 时写盘;每个 stamp 序列化 id/start/end/note/lastModified
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
                                // lastModified(v1.6 新增):per-row;Some(非 0) 才写
                                if let Some(ts) = s.last_modified {
                                    if ts > 0 {
                                        s_obj.insert("lastModified".into(), serde_json::Value::Number(ts.into()));
                                    }
                                }
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
    // prev_season_id: 仅在 Some(非空) 时写盘(v1.6 新增;跟 next_season_id 同款"空串不写"策略)
    // 由 service 层在 set_next_season 路径自动维护,或用户通过 books_set_prev_season 主动设。
    // 老数据缺字段 → None(向后兼容)
    if let Some(pid) = &book.prev_season_id {
        if !pid.is_empty() {
            fm.insert("prevSeasonId".into(), serde_json::Value::String(pid.clone()));
        }
    }
    // prev_season_explicit(v2.x 新增):仅在 true 时写盘。
    // false 是默认值(老数据无此字段也视作 false),不写盘避免污染 frontmatter;
    // true 表示用户主动设的 prev —— 粘性标记,set_next_season 反向同步看到会跳过清理。
    if book.prev_season_explicit {
        fm.insert(
            "prevSeasonExplicit".into(),
            serde_json::Value::Bool(true),
        );
    }
    // series_id(v1.7 新增):仅在 Some(非空) 时写盘;老文件缺字段 → None(向后兼容,serde default 兜底)。
    // 跟 next_season_id / prev_season_id 同款"空串不写"策略;稀疏写盘避免污染 frontmatter。
    if let Some(sid) = &book.series_id {
        if !sid.is_empty() {
            fm.insert("seriesId".into(), serde_json::Value::String(sid.clone()));
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
            series_id: None,
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
    /// - **v1.6 per-stamp lastModified**:Some(非 0) 写盘 + 读回同值;None / 0 / 缺损 → None
    ///   (与 EpisodeRecord.lastModified 同款写盘稀疏策略)
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
                        last_modified: None,
                    },
                    TimeStamp {
                        id: "id-001".to_string(),
                        start: 100,
                        end: None,
                        note: "开场".to_string(),
                        last_modified: None,
                    },
                    TimeStamp {
                        id: "id-003".to_string(),
                        start: 5000,
                        end: Some(5500),
                        note: "高潮".to_string(),
                        last_modified: None,
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
                    TimeStamp { id: "z-id".to_string(), start: 100, end: None, note: "Z".to_string(), last_modified: None },
                    TimeStamp { id: "a-id".to_string(), start: 100, end: None, note: "A".to_string(), last_modified: None },
                    TimeStamp { id: "m-id".to_string(), start: 100, end: None, note: "M".to_string(), last_modified: None },
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

        // 7) v1.6 per-stamp lastModified round-trip + 老数据 / 0 视为 None
        // 不变量:
        // - last_modified: Some(非 0) → 写盘 + 读回 Some(同值)
        // - 老文件缺 lastModified 字段 → 读回 None(向后兼容)
        // - last_modified: Some(0) / 非法值 → 视为 None(同 EpisodeRecord 处理)
        let mut input5 = sample_input();
        input5.kind = WorkKind::Tv;
        input5.seasons = Some(vec![SeasonInfo { number: 1, episode_count: 1, notes: None, last_modified: None }]);
        let book5 = write_book(&books_dir, &input5, &HashSet::new()).unwrap();
        let mut eps5 = EpisodeNotes::new();
        eps5.insert(
            "1-1".to_string(),
            EpisodeRecord {
                watched: true,
                note: String::new(),
                title: None,
                stamps: Some(vec![
                    TimeStamp { id: "st-with".to_string(), start: 100, end: None, note: "带时间戳".to_string(), last_modified: Some(1730000000000) },
                    TimeStamp { id: "st-none".to_string(), start: 200, end: None, note: "无时间戳".to_string(), last_modified: None },
                    // Some(0) 应被 filter 视为 None(同 EpisodeRecord.last_modified 处理)
                    TimeStamp { id: "st-zero".to_string(), start: 300, end: None, note: "零时间戳".to_string(), last_modified: Some(0) },
                ]),
                last_modified: None,
            },
        );
        let patch = BookPatch { episodes: Some(eps5), ..Default::default() };
        update_book(&books_dir, &book5.id, &patch).unwrap();

        // raw 写盘:带时间戳的 stamp 写 lastModified;None / 0 都不写
        let raw5 = std::fs::read_to_string(books_dir.join(format!("{}.md", book5.id))).unwrap();
        assert!(raw5.contains("\"id\": \"st-with\""), "带时间戳的 stamp 应写 id");
        assert!(raw5.contains("\"lastModified\": 1730000000000"), "带时间戳的 stamp 应写 lastModified");
        // st-none 的 lastModified 是 None → 不写该字段;用 count 兜底:
        // raw 里恰好出现 1 次 "st-with" + "lastModified" 配对(其他两条不应写)
        let with_count = raw5.matches("\"st-with\"").count();
        let lm_count = raw5.matches("\"lastModified\"").count();
        assert_eq!(with_count, 1, "st-with 应只出现 1 次");
        assert_eq!(lm_count, 1, "只有带非 0 时间戳的 stamp 才写 lastModified");

        // 读回:stamp 顺序按 start 升序
        let read5 = read_book(&books_dir, &book5.id).unwrap().unwrap();
        let stamps5 = read5.episodes.as_ref().unwrap().get("1-1").unwrap().stamps.as_ref().unwrap();
        assert_eq!(stamps5.len(), 3);
        // Some(非 0) → 保留值
        assert_eq!(stamps5[0].id, "st-with");
        assert_eq!(stamps5[0].last_modified, Some(1730000000000));
        // None → None
        assert_eq!(stamps5[1].id, "st-none");
        assert_eq!(stamps5[1].last_modified, None);
        // Some(0) → None(filter 视为无)
        assert_eq!(stamps5[2].id, "st-zero");
        assert_eq!(stamps5[2].last_modified, None);

        // 8) 老 stamp 数据(frontmatter 里没 lastModified 字段)→ 读回 None
        let legacy5 = books_dir.join("legacy-stamps.md");
        std::fs::write(
            &legacy5,
            "---\n{\"id\":\"legacy-stamps\",\"title\":\"老剧\",\"status\":\"finished\",\"kind\":\"tv\",\"episodes\":{\"1-1\":{\"watched\":true,\"note\":\"\",\"stamps\":[{\"id\":\"old\",\"start\":10,\"note\":\"老 stamp\"}]}}}\n---\n# 老剧\n",
        ).unwrap();
        let legacy5_book = read_book(&books_dir, "legacy-stamps").unwrap().unwrap();
        let legacy5_stamps = legacy5_book.episodes.as_ref().unwrap().get("1-1").unwrap().stamps.as_ref().unwrap();
        assert_eq!(legacy5_stamps.len(), 1);
        assert_eq!(legacy5_stamps[0].id, "old");
        assert!(legacy5_stamps[0].last_modified.is_none(), "老 stamp 缺字段 → None");
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

    /// 模拟用户场景「鉴证实录」:老 book 文件没 seasons 字段(老 tv 文件),
    /// 通过 set_seasons IPC 写一个新的 seasons 数组(模拟 EpisodesPanel "X 集"
    /// input 失焦写盘),确认持久化 + 读回都正常。
    /// 这覆盖了 fallback 路径(useSeasonsForBook 会用 progress.total 兜底显示)
    /// 与真实写盘路径(set_seasons 走 update_book + persist)的衔接。
    /// 注:service 模块 #[cfg(not(test))] 无法在 tests 里 import,这里直接 inline
    /// set_seasons 的实现(read → 改 merged.seasons → persist)。
    #[test]
    fn legacy_tv_set_seasons_round_trip() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 写一个「老 tv 文件」:有 kind=tv,但没 seasons / episodes / progress.total=null
        //   —— 对应 useSeasonsForBook 的 fallback 路径(book.seasons=undefined 时
        //   返回 [{number:1, episodeCount: progress.total ?? 0}],这里 total 是 null → 0)
        let legacy_path = books_dir.join("99.md");
        std::fs::write(
            &legacy_path,
            "---\n{\"id\":\"99\",\"title\":\"鉴证实录\",\"author\":\"TVB\",\"status\":\"want\",\"kind\":\"tv\",\"progress\":{\"current\":5,\"total\":null}}\n---\n# 鉴证实录\n",
        ).unwrap();

        // 2) 读出来:seasons 应为 None(老文件缺字段;normalize_book 走 fallback 路径)
        let book = read_book(&books_dir, "99").unwrap().unwrap();
        assert!(book.seasons.is_none(), "老文件缺 seasons → None");

        // 3) 模拟 EpisodesPanel flushSeasonCount 走的 store action:
        //   store.setSeasons(id, [{number:1, episodeCount:25}]) → IPC books_seasons_set →
        //   service::set_seasons → update_book patch { seasons: Some(...) } → persist
        //   这里 inline 等价路径:
        let mut book_for_update = read_book(&books_dir, "99").unwrap().unwrap();
        let new_seasons = vec![SeasonInfo { number: 1, episode_count: 25, notes: None, last_modified: None }];
        book_for_update.seasons = Some(new_seasons);
        book_for_update.updated = now_iso();
        persist(&books_dir, &book_for_update).unwrap();

        // 4) 磁盘上 raw 必须含 "seasons" + "episodeCount": 25
        let raw = std::fs::read_to_string(&legacy_path).unwrap();
        assert!(raw.contains("\"seasons\""), "raw 必须写 seasons 字段; raw={raw}");
        assert!(raw.contains("\"episodeCount\": 25"), "raw 必须含新集数; raw={raw}");

        // 5) 重新读:seasons 应有值,episodes 仍是 None
        let book2 = read_book(&books_dir, "99").unwrap().unwrap();
        assert_eq!(book2.seasons.as_ref().unwrap().len(), 1);
        assert_eq!(book2.seasons.as_ref().unwrap()[0].episode_count, 25);
    }

    // ===================================================================
    // ============= v1.6 prev_season_id + 双向同步测试 ===================
    // ===================================================================

    /// v2.x prevSeasonExplicit 字段的回归测试(data 层 persist + 读回策略)。
    /// 不变量:
    /// - `true` → 写盘到 frontmatter `prevSeasonExplicit: true`
    /// - `false` → 不写盘(默认/老数据 → 读回 false,避免污染 frontmatter)
    /// - 老文件缺 prevSeasonExplicit 字段 → 读回 false(向后兼容)
    #[test]
    fn prev_season_explicit_round_trip_and_omit() {
        let dir = temp_books_dir();
        let books_dir = dir.path(); // temp_books_dir() 已创建 books/ 子目录
        let mut existing = HashSet::new();

        // 1) 写 default book → prev_season_explicit 默认 false,frontmatter 不写
        let book1 = write_book(books_dir, &sample_input(), &mut existing).unwrap();
        let raw1 = std::fs::read_to_string(books_dir.join(format!("{}.md", book1.id))).unwrap();
        assert!(
            !raw1.contains("\"prevSeasonExplicit\""),
            "默认 false 不应写盘,避免污染 frontmatter; raw={raw1}"
        );

        // 2) 改 prev_season_explicit = true → 写盘
        let mut book2 = read_book(books_dir, &book1.id).unwrap().unwrap();
        book2.prev_season_explicit = true;
        book2.prev_season_id = Some("99".to_string());
        crate::data::books::persist(books_dir, &book2).unwrap();
        let raw2 = std::fs::read_to_string(books_dir.join(format!("{}.md", book1.id))).unwrap();
        assert!(raw2.contains("\"prevSeasonExplicit\": true"), "应写盘 true; raw={raw2}");

        // 3) 读回 = true
        let book3 = read_book(books_dir, &book1.id).unwrap().unwrap();
        assert!(book3.prev_season_explicit);
        assert_eq!(book3.prev_season_id.as_deref(), Some("99"));

        // 4) 改成 false → 不写盘(再次稀疏)
        let mut book4 = read_book(books_dir, &book1.id).unwrap().unwrap();
        book4.prev_season_explicit = false;
        crate::data::books::persist(books_dir, &book4).unwrap();
        let raw4 = std::fs::read_to_string(books_dir.join(format!("{}.md", book1.id))).unwrap();
        assert!(
            !raw4.contains("\"prevSeasonExplicit\""),
            "false 不应写盘; raw={raw4}"
        );
        let book5 = read_book(books_dir, &book1.id).unwrap().unwrap();
        assert!(!book5.prev_season_explicit, "读回应是 false");

        // 5) 老数据(手写 frontmatter 无 prevSeasonExplicit 字段) → 读回 false
        let legacy_dir = temp_books_dir();
        let legacy_path = legacy_dir.path().join("42.md");
        std::fs::write(
            &legacy_path,
            "---\n{\"id\": 42, \"title\": \"Legacy\", \"kind\": \"tv\", \"author\": \"a\", \
             \"country\": \"\", \"year\": 2024, \"translator\": \"\", \"status\": \"want\", \
             \"read_count\": 1, \"created\": \"2024-01-01T00:00:00Z\", \
             \"updated\": \"2024-01-01T00:00:00Z\", \"tags\": [], \"notes\": \"\", \
             \"starring\": \"\", \"screenwriter\": \"\"}\n---\n# Legacy\n",
        )
        .unwrap();
        let legacy = read_book(legacy_dir.path(), "42").unwrap().unwrap();
        assert!(!legacy.prev_season_explicit, "老数据无此字段 → 默认 false");
    }

    /// v1.6 prev_season_id 字段的回归测试(data 层 persist + 读回策略)。
    /// 不变量(跟 next_season_id 同款):
    /// - Some(非空) → 写盘到 frontmatter `prevSeasonId`;读回 Some(同值)
    /// - 空串 / None → 不写盘;读回 None
    /// - 老文件缺 prevSeasonId 字段 → 读回 None(向后兼容)
    #[test]
    fn prev_season_id_round_trip_and_omit() {
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 1) 新建 book → prev_season_id 默认 None,frontmatter 不写字段
        let book_a = write_book(&books_dir, &sample_input(), &HashSet::new()).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(!raw.contains("prevSeasonId"), "新建作品默认无 prevSeasonId; raw={raw}");

        // 2) Some(非空) → 写盘
        let mut book = read_book(&books_dir, &book_a.id).unwrap().unwrap();
        book.prev_season_id = Some("3".to_string());
        persist(&books_dir, &book).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(raw.contains("\"prevSeasonId\": \"3\""), "prevSeasonId 应写盘; raw={raw}");

        // 3) None → 不写盘
        let mut book = read_book(&books_dir, &book_a.id).unwrap().unwrap();
        book.prev_season_id = None;
        persist(&books_dir, &book).unwrap();
        let raw = std::fs::read_to_string(books_dir.join(format!("{}.md", book_a.id))).unwrap();
        assert!(!raw.contains("prevSeasonId"), "None 不应写盘; raw={raw}");

        // 4) 老文件缺 prevSeasonId → 读回 None(向后兼容)
        let legacy = books_dir.join("legacy-prev.md");
        std::fs::write(
            &legacy,
            "---\n{\"id\":\"legacy-prev\",\"title\":\"老剧\",\"status\":\"finished\",\"kind\":\"tv\"}\n---\n# 老剧\n",
        ).unwrap();
        let legacy_book = read_book(&books_dir, "legacy-prev").unwrap().unwrap();
        assert!(legacy_book.prev_season_id.is_none());
    }

    /// v1.6 双向同步测试:set_next_season 自动维护 prev_season_id 反向字段。
    /// 不变量:
    /// - A.nextSeasonId = B → A.next = B, B.prev = A
    /// - 改链:A.next = C(从 B 改到 C)→ A.next = C, C.prev = A, **B.prev 清掉**
    /// - 清链:A.next = None → A.next = None, **B.prev 也清掉**(B 不再有"指向我"的反向引用)
    /// - 重指:B 已有 prev = X,现在让 A.next = B → B.prev = A(X 被踢),X.next 清掉(若 X.next == B)
    /// - 目标 B 不存在(脏引用)→ A.next 照写,B 那边的 prev 不动(无文件可改),前端 UI 兜底
    #[test]
    fn set_next_season_two_way_sync() {
        use crate::service::books as svc;
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 准备三本书 + 一本 D(测试重指场景)。
        // 注意:write_book 内部 make_base_id 取 max+1,所以每次新建都得把上一步
        // 生成的 id 塞进 existing_ids,否则连续 4 次都生成 "1"(测试陷阱)。
        let mut existing: HashSet<String> = HashSet::new();
        let a = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(a.id.clone());
        let b = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(b.id.clone());
        let c = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(c.id.clone());
        let d = write_book(&books_dir, &sample_input(), &existing).unwrap();
        // 让现有 ID 不冲突
        assert_ne!(a.id, b.id);
        assert_ne!(a.id, c.id);
        assert_ne!(b.id, c.id);
        assert_ne!(a.id, d.id);

        // ---- 1) 设链 A.next = B → A.next = B, B.prev = A ----
        svc::set_next_season(&books_dir, &a.id, Some(b.id.clone())).unwrap();
        let a1 = read_book(&books_dir, &a.id).unwrap().unwrap();
        let b1 = read_book(&books_dir, &b.id).unwrap().unwrap();
        assert_eq!(a1.next_season_id.as_deref(), Some(b.id.as_str()));
        assert_eq!(b1.prev_season_id.as_deref(), Some(a.id.as_str()));
        assert!(a1.prev_season_id.is_none(), "A 自己没有 prev");

        // raw 写盘验证
        let raw_b = std::fs::read_to_string(books_dir.join(format!("{}.md", b.id))).unwrap();
        assert!(raw_b.contains("\"prevSeasonId\""), "B 写盘应含 prevSeasonId; raw={raw_b}");
        let raw_a = std::fs::read_to_string(books_dir.join(format!("{}.md", a.id))).unwrap();
        assert!(raw_a.contains("\"nextSeasonId\""), "A 写盘应含 nextSeasonId");

        // ---- 2) 改链:A.next = C → B.prev 清掉, C.prev = A ----
        svc::set_next_season(&books_dir, &a.id, Some(c.id.clone())).unwrap();
        let a2 = read_book(&books_dir, &a.id).unwrap().unwrap();
        let b2 = read_book(&books_dir, &b.id).unwrap().unwrap();
        let c2 = read_book(&books_dir, &c.id).unwrap().unwrap();
        assert_eq!(a2.next_season_id.as_deref(), Some(c.id.as_str()));
        assert!(b2.prev_season_id.is_none(), "B 不再是 A 的下一季 → B.prev 清掉");
        assert_eq!(c2.prev_season_id.as_deref(), Some(a.id.as_str()), "C 接管 → C.prev = A");
        // B 文件 raw 不应再含 prevSeasonId
        let raw_b2 = std::fs::read_to_string(books_dir.join(format!("{}.md", b.id))).unwrap();
        assert!(!raw_b2.contains("prevSeasonId"), "B 的 prevSeasonId 已清 → raw 不应含该字段; raw={raw_b2}");

        // ---- 3) 清链:A.next = None → C.prev 也清掉 ----
        svc::set_next_season(&books_dir, &a.id, None).unwrap();
        let c3 = read_book(&books_dir, &c.id).unwrap().unwrap();
        assert!(c3.prev_season_id.is_none(), "清空 A.next → C 不再被指向 → C.prev 清掉");
        let raw_c3 = std::fs::read_to_string(books_dir.join(format!("{}.md", c.id))).unwrap();
        assert!(!raw_c3.contains("prevSeasonId"));

        // ---- 4) 重指场景:B 已有 prev = D,现在让 A.next = B → D.next 清掉 ----
        // 先手工"模拟" B.prev = D(不通过 service,因为 service 不暴露 setPrevSeason)
        let mut b_now = read_book(&books_dir, &b.id).unwrap().unwrap();
        b_now.prev_season_id = Some(d.id.clone());
        persist(&books_dir, &b_now).unwrap();
        // 然后让 A.next = B(实际触发 prev 同步)
        svc::set_next_season(&books_dir, &a.id, Some(b.id.clone())).unwrap();
        let b_after = read_book(&books_dir, &b.id).unwrap().unwrap();
        let d_after = read_book(&books_dir, &d.id).unwrap().unwrap();
        assert_eq!(b_after.prev_season_id.as_deref(), Some(a.id.as_str()), "B.prev 应改为 A");
        assert!(d_after.next_season_id.is_none(), "D 不再是 B 的上一季 → D.next 清掉");

        // ---- 5) 目标 B 不存在(脏引用)→ A.next 照写,B 那边的 prev 不报错 ----
        svc::set_next_season(&books_dir, &a.id, Some("nonexistent-book-id".to_string())).unwrap();
        let a5 = read_book(&books_dir, &a.id).unwrap().unwrap();
        assert_eq!(a5.next_season_id.as_deref(), Some("nonexistent-book-id"));
        // D.prev 之前是 None → 没动;不存在 book 也不动(无文件可改)
        // 这里只检查"不报错"+ A.next 写对

        // ---- 6) 清理后再确认:清空后不残留脏引用 ----
        svc::set_next_season(&books_dir, &a.id, None).unwrap();
        let a_final = read_book(&books_dir, &a.id).unwrap().unwrap();
        assert!(a_final.next_season_id.is_none(), "清空后 A.next = None");
        assert!(a_final.prev_season_id.is_none(), "A 自己 prev 一直保持 None");
        let b_final = read_book(&books_dir, &b.id).unwrap().unwrap();
        assert!(b_final.prev_season_id.is_none(), "清空后 B.prev = None");
    }

    /// v1.6 删除 book 时清理指向 / 被指向的季链关联。
    /// 不变量:
    /// - X.next == Y,Y 被删 → X.next 清掉
    /// - Y.prev == X,X 被删 → Y.prev 清掉
    /// - 多本书指向同一本被删 → 都清掉
    /// - 不重定向(A.next=Y,B.next=Z,Y 被删后 A.next 不自动接到 Z)
    #[test]
    fn delete_book_clears_season_chain_references() {
        use crate::service::books as svc;
        let dir = temp_books_dir();
        let books_dir = dir.path().join("books");

        // 见上一个测试的注释 —— 每次 write_book 都要把上一步 id 塞进 existing_ids,
        // 否则所有 id 都是 "1"。
        let mut existing: HashSet<String> = HashSet::new();
        let a = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(a.id.clone());
        let y = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(y.id.clone());
        let z = write_book(&books_dir, &sample_input(), &existing).unwrap();
        existing.insert(z.id.clone());
        let x = write_book(&books_dir, &sample_input(), &existing).unwrap();
        // 防御:确认 ID 真的不冲突
        assert_ne!(a.id, y.id);
        assert_ne!(a.id, x.id);
        assert_ne!(y.id, x.id);

        // A.next = Y,Y.prev = A(走 service 自动同步)
        svc::set_next_season(&books_dir, &a.id, Some(y.id.clone())).unwrap();
        // 再让 X.prev = Y(模拟 Y 是 X 的上一季)
        let mut y_now = read_book(&books_dir, &y.id).unwrap().unwrap();
        y_now.prev_season_id = Some(x.id.clone());
        persist(&books_dir, &y_now).unwrap();
        // X.next 也指向 Y(双向都有)
        let mut x_now = read_book(&books_dir, &x.id).unwrap().unwrap();
        x_now.next_season_id = Some(y.id.clone());
        persist(&books_dir, &x_now).unwrap();

        // 删除 Y
        delete_book(&books_dir, &y.id).unwrap();

        // 1) A.next = None(原指向 Y)
        let a_after = read_book(&books_dir, &a.id).unwrap().unwrap();
        assert!(a_after.next_season_id.is_none(), "A.next 原指 Y,Y 被删 → 清掉; got={:?}", a_after.next_season_id);
        // 2) X.next = None(原指向 Y)
        let x_after = read_book(&books_dir, &x.id).unwrap().unwrap();
        assert!(x_after.next_season_id.is_none(), "X.next 原指 Y,Y 被删 → 清掉; got={:?}", x_after.next_season_id);
        // 3) X.prev 之前是 None → 没动(测试不残留脏字段)
        assert!(x_after.prev_season_id.is_none());

        // 4) 不重定向:即使 A.next 被清,Z 也没"自动"被接到 A.next
        let a_final = read_book(&books_dir, &a.id).unwrap().unwrap();
        assert!(a_final.next_season_id.is_none());

        // 5) raw 写盘确认
        let raw_a = std::fs::read_to_string(books_dir.join(format!("{}.md", a.id))).unwrap();
        assert!(!raw_a.contains("nextSeasonId"), "A 的 nextSeasonId 已清 → raw 不应含该字段");
        let raw_x = std::fs::read_to_string(books_dir.join(format!("{}.md", x.id))).unwrap();
        assert!(!raw_x.contains("nextSeasonId"), "X 的 nextSeasonId 已清 → raw 不应含该字段");

        // 6) Z 完全没被动过(本来就没参与链)
        let z_after = read_book(&books_dir, &z.id).unwrap().unwrap();
        assert!(z_after.next_season_id.is_none());
        assert!(z_after.prev_season_id.is_none());
    }
}
