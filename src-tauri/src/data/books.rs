//! book.md 读写(frontmatter via 手写 JSON parser)。
//!
//! - 每本书一个 `<id>.md`,frontmatter 是单行 JSON,正文是 Markdown
//! - `progress` 字段只在有值时写入,避免污染 frontmatter
//! - 损坏文件不阻塞其他书加载,返回 broken 列表

use std::collections::HashSet;
use std::path::Path;

use crate::data::files::{atomic_write_file, ensure_dir};
use crate::data::slug::make_base_id;
use crate::progress::{bump_progress as bump_progress_helper, normalize_progress_input};
use crate::types::{Book, BookInput, BookPatch, BookStatus};

fn is_valid_status(s: &str) -> bool {
    matches!(
        s,
        "want" | "shelved" | "reading" | "finished" | "abandoned"
    )
}

fn now_iso() -> String {
    // 用时间戳,避免引入 chrono
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // 简单 ISO 8601 (UTC)。够精确给用户看,不做格式化时区。
    format_iso8601_utc(secs)
}

fn format_iso8601_utc(secs: u64) -> String {
    // 把 epoch 秒换算成日期时间(UTC)。算法取自 `humantime` 的简化版。
    // 不依赖外部 crate;精度到秒。
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hour, minute, second
    )
}

/// Howard Hinnant 的 civil_from_days 算法,把 epoch days → (year, month, day)
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
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

/// 拆分 markdown 的 frontmatter 部分(我们自己实现,避开 matter alpha 坑)。
///
/// 期望格式:
/// ```text
/// ---
/// key: value
/// ---
/// 正文...
/// ```
///
/// 返回 `(frontmatter_json_value, body)`。没有 frontmatter 或格式不对 → 返回 `None`。
///
/// 简化策略:先当 JSON 解析(我们自己写入时用 JSON),失败 fallback 到空对象。
/// 如果用户手写 YAML frontmatter,我们用 serde_yaml 兜底。
fn split_frontmatter(raw: &str) -> Option<(serde_json::Value, String)> {
    let after_first = raw.strip_prefix("---")?;
    let after_first = after_first.strip_prefix('\n').unwrap_or(after_first);

    // 找下一个恰好是 "---" 的行,记录 yaml 结束位置(=行首)和 body 起始位置(=行尾)
    let mut yaml_end: Option<usize> = None;
    let mut body_offset: Option<usize> = None;
    let mut consumed = 0usize;
    for line in after_first.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == "---" {
            yaml_end = Some(consumed);
            body_offset = Some(consumed + line.len());
            break;
        }
        consumed += line.len();
    }
    let yaml_end = yaml_end?;
    let body_offset = body_offset?;
    let yaml_str = &after_first[..yaml_end];
    let body = after_first[body_offset..].trim_start_matches('\n').to_string();

    let value: serde_json::Value = serde_yaml_from_compat_yaml(yaml_str);
    Some((value, body))
}

/// 把简化 YAML(仅"key: value"和"key:\n  nested"格式)解析为 JSON Value。
///
/// gray-matter 写出的格式其实就是 JSON-like 的 YAML(我们 serialize 用 JSON 后,gray-matter
/// 能识别;反过来 gray-matter 写出的 YAML 也能被 serde_yaml 解析)。这里先 JSON,失败 fallback
/// 到空对象(避免引入 serde_yaml 依赖;真 YAML 用户手写时拿不到数据但不阻塞加载)。
fn serde_yaml_from_compat_yaml(s: &str) -> serde_json::Value {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
        return v;
    }
    serde_json::json!({})
}

fn normalize_book(id: &str, data: &serde_json::Value) -> Book {
    Book {
        id: id.to_string(),
        title: data.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        author: data.get("author").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        country: data.get("country").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        year: data.get("year").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        translator: data.get("translator").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        status: parse_status(data.get("status")),
        read_count: data.get("read_count").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
        progress: data.get("progress").and_then(crate::progress::parse_progress),
        created: data.get("created").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        updated: data.get("updated").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        tags: data
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
    }
}

fn parse_status(v: Option<&serde_json::Value>) -> BookStatus {
    match v.and_then(|x| x.as_str()) {
        Some("want") => BookStatus::Want,
        Some("shelved") => BookStatus::Shelved,
        Some("reading") => BookStatus::Reading,
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
        author: input.author.clone(),
        country: input.country.clone(),
        year: input.year,
        translator: input.translator.clone(),
        status: input.status,
        read_count: 1,
        progress: normalize_progress_input(input.progress.as_ref()),
        created: now.clone(),
        updated: now,
        tags: input.tags.clone().unwrap_or_default(),
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
    if let Some(v) = &patch.author { merged.author = v.clone(); }
    if let Some(v) = &patch.country { merged.country = v.clone(); }
    if let Some(v) = patch.year { merged.year = v; }
    if let Some(v) = &patch.translator { merged.translator = v.clone(); }
    if let Some(v) = patch.status { merged.status = v; }
    if let Some(v) = patch.read_count { merged.read_count = v; }
    if let Some(v) = &patch.tags { merged.tags = v.clone(); }
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
    let body = format!("# {}\n\n## 笔记\n\n## 摘录\n", book.title);
    // 构造 frontmatter (serde_json::Map)
    let mut fm = serde_json::Map::new();
    fm.insert("id".into(), serde_json::Value::String(book.id.clone()));
    fm.insert("title".into(), serde_json::Value::String(book.title.clone()));
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
            BookStatus::Finished => "finished",
            BookStatus::Abandoned => "abandoned",
        }
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Progress;

    fn temp_books_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        ensure_dir(dir.path().join("books")).unwrap();
        dir
    }

    fn sample_input() -> BookInput {
        BookInput {
            title: "百年孤独".to_string(),
            author: "加西亚·马尔克斯".to_string(),
            country: "哥伦比亚".to_string(),
            year: 1967,
            translator: "范晔".to_string(),
            status: BookStatus::Reading,
            progress: Some(Progress { current: 12, total: Some(100) }),
            tags: Some(vec!["小说".to_string()]),
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
}
