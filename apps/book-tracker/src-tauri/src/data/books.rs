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
use crate::types::{Book, BookInput, BookPatch, BookStatus, WorkKind};

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
    }
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

fn persist(books_dir: impl AsRef<Path>, book: &Book) -> std::io::Result<()> {
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
}
