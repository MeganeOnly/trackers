//! 进度纯函数 —— 解析 / 归一 / 百分比 / 累加。
//!
//! 与 `packages/tracker-core/src/progress.ts` 行为对齐（见 vitest 单测）。
//! `format_progress`（含"章 · 连载中"等文案）是领域专属，留在各 app。

use crate::types::Progress;

/// 从 frontmatter 原始值规整成 `Progress | null`。
///
/// 容错策略：
/// - 缺字段 / 类型不对 / `current` 非数/负 → `None`
/// - `total=0`/负/非数 → fallback 为 `total=None`（保留 current，UI 显示"未知总量"）
pub fn parse_progress(raw: &serde_json::Value) -> Option<Progress> {
    if raw.is_null() {
        return None;
    }
    let obj = raw.as_object()?;

    let c_f = obj.get("current").and_then(|v| v.as_f64());
    let Some(c) = c_f else { return None };
    if !c.is_finite() || c < 0.0 {
        return None;
    }
    let current = c.floor() as u32;

    let t_value = obj.get("total");
    if t_value.is_none() || t_value.map(|v| v.is_null()).unwrap_or(false) {
        return Some(Progress {
            current,
            total: None,
        });
    }
    let t_f = t_value.and_then(|v| v.as_f64());
    let Some(t) = t_f else {
        return Some(Progress {
            current,
            total: None,
        });
    };
    if !t.is_finite() || t <= 0.0 {
        return Some(Progress {
            current,
            total: None,
        });
    }
    Some(Progress {
        current,
        total: Some(t.floor() as u32),
    })
}

/// 把用户/表单输入的 `Progress | null` 规整为 `Progress | null`。
pub fn normalize_progress_input(p: Option<&Progress>) -> Option<Progress> {
    let p = p?;
    let c = p.current as f64;
    if !c.is_finite() || c < 0.0 {
        return None;
    }
    let current = c.floor() as u32;

    match p.total {
        None => Some(Progress {
            current,
            total: None,
        }),
        Some(t) => {
            let t = t as f64;
            if !t.is_finite() || t <= 0.0 {
                Some(Progress {
                    current,
                    total: None,
                })
            } else {
                Some(Progress {
                    current,
                    total: Some(t.floor() as u32),
                })
            }
        }
    }
}

/// 0-100 进度百分比。`total=None` 或 `total=0` 时返回 0。
pub fn progress_percent(p: Option<&Progress>) -> f64 {
    let p = match p {
        Some(p) => p,
        None => return 0.0,
    };
    let total = match p.total {
        Some(t) if t > 0 => t,
        _ => return 0.0,
    };
    let pct = (p.current as f64 / total as f64) * 100.0;
    pct.clamp(0.0, 100.0)
}

/// 快速调整 `current`。
///
/// - 当前 `None`：初始化为 `{ current: max(delta, 1), total: null }`
/// - `delta > 0`：递增
/// - `delta < 0`：递减，下限 0
pub fn bump_progress(current: Option<&Progress>, delta: i32) -> Progress {
    let cur = current.map(|p| p.current as i32).unwrap_or(0);
    let next_raw = cur + delta;
    match current {
        Some(p) => {
            let next = next_raw.max(0) as u32;
            Progress {
                current: next,
                total: p.total,
            }
        }
        None => Progress {
            current: next_raw.max(1) as u32,
            total: None,
        },
    }
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_progress_null_or_undefined() {
        assert!(parse_progress(&json!(null)).is_none());
    }

    #[test]
    fn parse_progress_non_object() {
        assert!(parse_progress(&json!(42)).is_none());
        assert!(parse_progress(&json!("hello")).is_none());
    }

    #[test]
    fn parse_progress_only_current() {
        assert_eq!(
            parse_progress(&json!({"current": 12})),
            Some(Progress {
                current: 12,
                total: None
            })
        );
    }

    #[test]
    fn parse_progress_current_and_total() {
        assert_eq!(
            parse_progress(&json!({"current": 12, "total": 100})),
            Some(Progress {
                current: 12,
                total: Some(100)
            })
        );
    }

    #[test]
    fn parse_progress_invalid_current() {
        assert!(parse_progress(&json!({"current": -1, "total": 100})).is_none());
        assert!(parse_progress(&json!({"current": "abc", "total": 100})).is_none());
        assert!(parse_progress(&json!({"current": null, "total": 100})).is_none());
    }

    #[test]
    fn parse_progress_total_zero_or_negative_falls_back_to_null() {
        assert_eq!(
            parse_progress(&json!({"current": 12, "total": 0})),
            Some(Progress {
                current: 12,
                total: None
            })
        );
        assert_eq!(
            parse_progress(&json!({"current": 12, "total": -5})),
            Some(Progress {
                current: 12,
                total: None
            })
        );
    }

    #[test]
    fn parse_progress_floors_current_and_total() {
        assert_eq!(
            parse_progress(&json!({"current": 12.7, "total": 100})),
            Some(Progress {
                current: 12,
                total: Some(100)
            })
        );
    }

    #[test]
    fn normalize_progress_input_semantics_match() {
        assert!(normalize_progress_input(None).is_none());
        assert_eq!(
            normalize_progress_input(Some(&Progress {
                current: 12,
                total: Some(100)
            })),
            Some(Progress {
                current: 12,
                total: Some(100)
            })
        );
        assert_eq!(
            normalize_progress_input(Some(&Progress {
                current: 5,
                total: None
            })),
            Some(Progress {
                current: 5,
                total: None
            })
        );
        assert_eq!(
            normalize_progress_input(Some(&Progress {
                current: 12,
                total: Some(0)
            })),
            Some(Progress {
                current: 12,
                total: None
            })
        );
    }

    #[test]
    fn progress_percent_basic() {
        let p = Progress {
            current: 25,
            total: Some(100),
        };
        assert_eq!(progress_percent(Some(&p)), 25.0);
        let p = Progress {
            current: 50,
            total: Some(200),
        };
        assert_eq!(progress_percent(Some(&p)), 25.0);
    }

    #[test]
    fn progress_percent_clamps_at_100() {
        let p = Progress {
            current: 150,
            total: Some(100),
        };
        assert_eq!(progress_percent(Some(&p)), 100.0);
    }

    #[test]
    fn progress_percent_null_total() {
        let p = Progress {
            current: 50,
            total: None,
        };
        assert_eq!(progress_percent(Some(&p)), 0.0);
    }

    #[test]
    fn progress_percent_null() {
        assert_eq!(progress_percent(None), 0.0);
    }

    #[test]
    fn bump_progress_positive_delta() {
        let p = Progress {
            current: 10,
            total: Some(100),
        };
        assert_eq!(
            bump_progress(Some(&p), 1),
            Progress {
                current: 11,
                total: Some(100)
            }
        );
        assert_eq!(
            bump_progress(Some(&p), 5),
            Progress {
                current: 15,
                total: Some(100)
            }
        );
    }

    #[test]
    fn bump_progress_negative_delta_floors_at_zero() {
        let p = Progress {
            current: 10,
            total: Some(100),
        };
        assert_eq!(
            bump_progress(Some(&p), -1),
            Progress {
                current: 9,
                total: Some(100)
            }
        );
        let p2 = Progress {
            current: 2,
            total: Some(100),
        };
        assert_eq!(
            bump_progress(Some(&p2), -5),
            Progress {
                current: 0,
                total: Some(100)
            }
        );
    }

    #[test]
    fn bump_progress_none_initializes() {
        assert_eq!(
            bump_progress(None, 1),
            Progress {
                current: 1,
                total: None
            }
        );
        assert_eq!(
            bump_progress(None, 5),
            Progress {
                current: 5,
                total: None
            }
        );
        assert_eq!(
            bump_progress(None, -1),
            Progress {
                current: 1,
                total: None
            }
        );
    }

    #[test]
    fn bump_progress_preserves_total() {
        let p = Progress {
            current: 10,
            total: None,
        };
        assert_eq!(
            bump_progress(Some(&p), 1),
            Progress {
                current: 11,
                total: None
            }
        );
    }
}
