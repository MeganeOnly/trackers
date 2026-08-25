//! frontmatter 通用工具 —— markdown `---` frontmatter 拆分 + ISO 时间戳。
//!
//! 从 book-tracker `data/books.rs` 抽取，泛化为领域无关（不依赖 Book 类型）。
//! 各 app 的条目文件格式：`---\n<JSON-like>\n---\n<markdown body>`。

use serde_json::Value;

/// 拆分 markdown 的 frontmatter 部分。
///
/// 期望格式：
/// ```text
/// ---
/// key: value
/// ---
/// 正文...
/// ```
///
/// 返回 `(frontmatter_json_value, body)`。没有 frontmatter 或格式不对 → `None`。
/// 解析策略：写盘时用 JSON（serde_json 直接解析）；解析失败 fallback 空对象，
/// 不阻塞加载（用户手写 YAML 时拿不到结构化字段但应用不会崩）。
pub fn split_frontmatter(raw: &str) -> Option<(Value, String)> {
    let after_first = raw.strip_prefix("---")?;
    let after_first = after_first.strip_prefix('\n').unwrap_or(after_first);

    // 找下一个恰好是 "---" 的行，记录 yaml 结束位置（=行首）和 body 起始位置（=行尾）
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

    let value = compat_yaml_to_json(yaml_str);
    Some((value, body))
}

/// 把简化 YAML（"key: value" / JSON-like）解析为 JSON Value；失败 fallback 空对象。
fn compat_yaml_to_json(s: &str) -> Value {
    if let Ok(v) = serde_json::from_str::<Value>(s) {
        return v;
    }
    serde_json::json!({})
}

/// 当前 UTC 时间的 ISO 8601（秒级精度，`.000Z` 后缀）。
pub fn now_iso() -> String {
    // 用时间戳，避免引入 chrono
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    format_iso8601_utc(secs)
}

/// 把 epoch 秒换算成 ISO 8601 字符串（UTC）。算法取自 `humantime` 的简化版。
pub fn format_iso8601_utc(secs: u64) -> String {
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

/// Howard Hinnant 的 civil_from_days 算法，把 epoch days → (year, month, day)
pub fn civil_from_days(z: i64) -> (i32, u32, u32) {
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

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_frontmatter_and_body() {
        let raw = "---\n{\"id\": 1, \"title\": \"t\"}\n---\n# Title\n\nbody";
        let (value, body) = split_frontmatter(raw).unwrap();
        assert_eq!(value["title"], "t");
        assert_eq!(body, "# Title\n\nbody");
    }

    #[test]
    fn crlf_frontmatter_handled() {
        let raw = "---\r\n{\"id\": 1}\r\n---\r\n# Title\r\n";
        let (value, body) = split_frontmatter(raw).unwrap();
        assert_eq!(value["id"], 1);
        assert_eq!(body, "# Title\r\n");
    }

    #[test]
    fn no_frontmatter_returns_none() {
        assert!(split_frontmatter("# plain body").is_none());
        assert!(split_frontmatter("").is_none());
    }

    #[test]
    fn invalid_frontmatter_falls_back_to_empty_object() {
        let raw = "---\nstatus: invalid_yaml:{{\n---\n# x\n";
        let (value, _body) = split_frontmatter(raw).unwrap();
        assert!(value.as_object().unwrap().is_empty());
    }

    #[test]
    fn now_iso_is_iso8601_shape() {
        let s = now_iso();
        assert!(s.len() >= 24, "unexpected iso shape: {s}");
        assert!(s.ends_with("Z"));
        assert!(s.contains('T'));
    }

    #[test]
    fn civil_from_days_known_date() {
        // 1970-01-01 = epoch day 0
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2024-01-15
        assert_eq!(civil_from_days(19737), (2024, 1, 15));
    }

    #[test]
    fn format_iso8601_utc_epoch() {
        assert_eq!(format_iso8601_utc(0), "1970-01-01T00:00:00.000Z");
    }
}