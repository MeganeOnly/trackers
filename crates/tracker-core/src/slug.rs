//! 纯数字 ID 生成：取现有 ID 中的最大数字 +1。
//!
//! 从 book-tracker 抽取（领域无关）：
//! - 非数字 ID（如老 pinyin slug）被忽略，不参与最大值计算
//! - 数字 ID 之间天然唯一，不需要额外 collision 处理
//! - 若现有 ID 全是非数字，从 1 开始

/// 计算下一个 ID。
pub fn make_base_id<I>(existing_ids: I) -> String
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    let mut max: u64 = 0;
    for id in existing_ids {
        let s = id.as_ref();
        if let Ok(n) = s.parse::<u64>() {
            if n > max {
                max = n;
            }
        }
    }
    (max + 1).to_string()
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_list_starts_at_one() {
        assert_eq!(make_base_id(std::iter::empty::<&str>()), "1");
    }

    #[test]
    fn pure_numeric_takes_max_plus_one() {
        assert_eq!(make_base_id(["1", "2", "3"]), "4");
        assert_eq!(make_base_id(["10", "5", "20"]), "21");
    }

    #[test]
    fn non_numeric_ids_are_ignored() {
        assert_eq!(make_base_id(["ai-zi-ji", "fa-shi", "5"]), "6");
    }

    #[test]
    fn all_non_numeric_falls_back_to_one() {
        assert_eq!(make_base_id(["abc", "xyz"]), "1");
    }

    #[test]
    fn mixed_case_treated_as_non_numeric() {
        assert_eq!(make_base_id(["1a", "2", "10b"]), "3");
    }
}
