//! 候选剧集业务逻辑 —— id 生成、promote 转 books、列表 / 添加 / 删除。
//!
//! 与 `data/candidates` 1:1 对应（业务层只在 data 之上加 id 时间戳 / promote 联动）。
//!
//! **不引入 chrono / uuid 依赖**：用 `SystemTime` 算 unix 毫秒，自写 ISO 8601
//! 格式化和 Gregorian proleptic 日期换算。够用，且跟项目其他 service 一致。

use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::data::candidates as data;
use crate::service::books;
use crate::types::{BookInput, Candidate, CandidatesFile, PromoteStatus};

/// 当前 unix 毫秒时间戳。
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// ISO 8601 时间戳（UTC，毫秒精度）。
/// 跟 TS 端 `new Date().toISOString()` 一致：长度 24，形如 `2026-09-05T12:34:56.789Z`。
fn now_iso() -> String {
    let ms = now_ms() as i64;
    let secs = ms.div_euclid(1000);
    let ms_part = ms.rem_euclid(1000);
    let (year, month, day, hour, minute, second) = unix_secs_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, ms_part
    )
}

/// unix 秒 → (year, month, day, hour, minute, second)，Gregorian proleptic。
/// 范围支持 1970-01-01 之后（够用）。
fn unix_secs_to_ymdhms(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let hour = (secs_of_day / 3600) as u32;
    let minute = ((secs_of_day % 3600) / 60) as u32;
    let second = (secs_of_day % 60) as u32;
    let (y, m, d) = days_to_ymd(days);
    (y, m, d, hour, minute, second)
}

fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    // 400 年周期法：146097 天 = 400 年
    let n400 = days.div_euclid(146_097);
    let d400 = days.rem_euclid(146_097);
    let n100 = d400.div_euclid(36_524);
    let d100 = d400.rem_euclid(36_524);
    let n4 = d100.div_euclid(1_461);
    let d4 = d100.rem_euclid(1_461);
    let n1 = d4.div_euclid(365);
    let d1 = d4.rem_euclid(365);

    let leap = n1 == 4;
    let n1 = if leap { 3 } else { n1 };
    // 在 i64 下算 year，最后 try_into 到 i32（1970-9999 范围内不会溢出）
    let year_i64: i64 = 400 * n400 + 100 * n100 + 4 * n4 + n1 + 1970;
    let year: i32 = year_i64
        .try_into()
        .expect("year out of i32 range (date computation overflow)");
    let day_of_year = if leap { 365 } else { d1 };

    let month_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut day_of_year = day_of_year;
    let mut month = 1u32;
    for &dm in &month_days {
        if day_of_year < dm {
            day_of_year += 1;
            break;
        }
        day_of_year -= dm;
        month += 1;
    }
    (year, month, day_of_year as u32)
}

fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// 生成候选 id：`c_<unix_ms>`。同 ms 内多次调用会重复 —— service 层做了"标题查重"
/// 兜底，所以重复 id 会原地替换而不是并排出现。
fn gen_id() -> String {
    format!("c_{}", now_ms())
}

/// 列出全部候选（按 added_at 倒序）。
pub fn list(data_dir: impl AsRef<Path>) -> io::Result<CandidatesFile> {
    let mut f = data::read_all(data_dir)?;
    f.items.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    Ok(f)
}

/// 新增一条候选。同 title 不重复加（返回已有）。
pub fn add(
    data_dir: impl AsRef<Path>,
    title: &str,
    tags: &[String],
    note: Option<&str>,
) -> io::Result<Candidate> {
    let title = title.trim();
    if title.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "candidate title must not be empty",
        ));
    }
    if let Some(existing) = data::find_by_title(&data_dir, title)? {
        return Ok(existing);
    }
    let note_owned = note.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let c = Candidate {
        id: gen_id(),
        title: title.to_string(),
        tags: tags.to_vec(),
        note: note_owned,
        added_at: now_iso(),
    };
    data::append(&data_dir, &c)?;
    Ok(c)
}

/// 删除一条候选。
pub fn remove(data_dir: impl AsRef<Path>, id: &str) -> io::Result<()> {
    data::remove_by_id(data_dir, id)?;
    Ok(())
}

/// 把候选转为 books 条目（kind='tv'，按 status 创建），完成后从 candidates 删除。
/// 元数据（author / country / year / starring / screenwriter 等）由用户在 book-tracker 详情页
/// 补全 —— 这里只填 title / tags / kind / status，其他字段用空串或 0。
pub fn promote(
    data_dir: impl AsRef<Path>,
    id: &str,
    status: PromoteStatus,
) -> io::Result<crate::types::Book> {
    let f = data::read_all(&data_dir)?;
    let candidate = f
        .items
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("candidate not found: {id}"),
            )
        })?
        .clone();

    let books_dir = crate::data::config::paths::books_dir(&data_dir.as_ref().to_string_lossy());

    let book_status = match status {
        PromoteStatus::Want => crate::types::BookStatus::Want,
        PromoteStatus::Finished => crate::types::BookStatus::Finished,
    };

    let input = BookInput {
        title: candidate.title.clone(),
        kind: crate::types::WorkKind::Tv,
        author: String::new(),
        country: String::new(),
        year: 0,
        translator: String::new(),
        status: book_status,
        progress: None,
        tags: Some(candidate.tags.clone()),
        collapsed: false,
        notes: String::new(),
        starring: String::new(),
        screenwriter: String::new(),
        seasons: None,
        series_id: None,
    };

    let book = books::create_book(&books_dir, &input)?;
    data::remove_by_id(&data_dir, id)?;
    Ok(book)
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn now_iso_format_is_valid() {
        let s = now_iso();
        assert!(s.ends_with('Z'));
        assert!(s.contains('T'));
        assert_eq!(s.len(), 24);
    }

    #[test]
    fn unix_secs_to_ymdhms_epoch() {
        assert_eq!(unix_secs_to_ymdhms(0), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn unix_secs_to_ymdhms_known_dates() {
        // 2000-01-01 00:00:00 UTC = 946684800
        assert_eq!(unix_secs_to_ymdhms(946_684_800), (2000, 1, 1, 0, 0, 0));
        // 2020-01-01 00:00:00 UTC = 1577836800
        assert_eq!(unix_secs_to_ymdhms(1_577_836_800), (2020, 1, 1, 0, 0, 0));
    }

    #[test]
    fn add_returns_existing_for_duplicate_title() {
        let dir = tempdir().unwrap();
        let c1 = add(dir.path(), "大宋提刑官", &["古装".into()], None).unwrap();
        let c2 = add(dir.path(), "大宋提刑官", &["古装".into()], None).unwrap();
        assert_eq!(c1.id, c2.id);
    }

    #[test]
    fn add_rejects_empty_title() {
        let dir = tempdir().unwrap();
        assert!(add(dir.path(), "", &["tag".into()], None).is_err());
        assert!(add(dir.path(), "  ", &["tag".into()], None).is_err());
    }

    #[test]
    fn add_strips_whitespace_and_empty_note() {
        let dir = tempdir().unwrap();
        let c = add(dir.path(), "  鉴证实录  ", &["港剧".into()], Some("")).unwrap();
        assert_eq!(c.title, "鉴证实录");
        assert!(c.note.is_none());
    }

    #[test]
    fn list_sorts_by_added_at_desc() {
        let dir = tempdir().unwrap();
        add(dir.path(), "A", &[], None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        add(dir.path(), "B", &[], None).unwrap();
        let f = list(dir.path()).unwrap();
        assert_eq!(f.items.len(), 2);
        assert_eq!(f.items[0].title, "B");
    }

    #[test]
    fn promote_creates_tv_book_and_removes_candidate() {
        let dir = tempdir().unwrap();
        let c = add(
            dir.path(),
            "大宋提刑官",
            &["古装".into(), "断案".into()],
            None,
        )
        .unwrap();
        // 在 data_dir 里建 books 子目录（service 层会自动 ensure）
        let book = promote(dir.path(), &c.id, PromoteStatus::Want).unwrap();
        assert_eq!(book.title, "大宋提刑官");
        assert_eq!(book.kind, crate::types::WorkKind::Tv);
        assert_eq!(book.status, crate::types::BookStatus::Want);
        assert_eq!(book.tags, vec!["古装".to_string(), "断案".to_string()]);
        // candidate 已被删除
        let after = list(dir.path()).unwrap();
        assert!(after.items.is_empty());
    }

    #[test]
    fn promote_finished_creates_finished_book() {
        let dir = tempdir().unwrap();
        let c = add(dir.path(), "X", &[], None).unwrap();
        let book = promote(dir.path(), &c.id, PromoteStatus::Finished).unwrap();
        assert_eq!(book.status, crate::types::BookStatus::Finished);
    }

    #[test]
    fn promote_missing_id_errors() {
        let dir = tempdir().unwrap();
        let err = promote(dir.path(), "c_nope", PromoteStatus::Want).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
