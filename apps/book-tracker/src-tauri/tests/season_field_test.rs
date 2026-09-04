//! 跨进程 IPC 字段名对齐的回归测试 —— book-renderer (TS) ↔ book-tracker (Rust)。
//!
//! 跑：`cargo test -p book-tracker --test season_field_test`
//!
//! ## 背景
//!
//! Tauri 2 的 `#[tauri::command]` 宏**只对顶层参数**做 snake_case ↔ camelCase 转换
//! （`next_season_id` ↔ `nextSeasonId` 由它兜底），但**不递归**到嵌套 struct 字段。
//! 嵌套 struct 字段的 JSON 键名由 `serde` 默认行为决定——按 Rust 字段名严格匹配。
//!
//! TS 域类型用 camelCase（`episodeCount` / `lastModified` / `nextSeasonId`），
//! Rust 域类型用 snake_case（`episode_count` / `last_modified` / `next_season_id`）。
//! 不加 `#[serde(rename_all = "camelCase")]` 时，IPC payload 直接 mismatch：
//!
//! - `episode_count` 没有 `#[serde(default)]` → **响亮失败**
//!   "missing field `episode_count`"，IPC reject，前端无 UI 反馈
//! - `last_modified` 有 `#[serde(default)]` → **静默丢弃**时间戳
//! - `Book.next_season_id` 序列化为 `next_season_id`，TS `book.nextSeasonId` 永远 undefined
//!
//! 文件格式不受影响：`persist` / `parse_*` 手写 JSON，不经过 serde。
//!
//! ## 本测试覆盖
//!
//! 1. `seasons_render_payload_should_deserialize` —— TS 风格 camelCase payload
//!    应当能反序列化进 `Vec<SeasonInfo>`（修前是 `Err`）
//! 2. `seasons_rust_serializes_camelCase` —— Rust `SeasonInfo { episode_count: 25 }`
//!    序列化产物 JSON 应当含 `"episodeCount": 25`，不含 `"episode_count"` 字面量
//! 3. `episode_record_round_trips_last_modified` —— camelCase payload 进 `EpisodeRecord`
//!    后 `last_modified` 等于发送值（修前是 `None`）
//! 4. `book_next_season_id_serializes_as_camelCase` —— `Book { next_season_id: Some("5") }`
//!    序列化产物 JSON 应当含 `"nextSeasonId": "5"`
//!
//! 这些 case 镜像 book-tracker/src-tauri/src/types.rs 里 `SeasonInfo` / `EpisodeRecord` /
//! `Character` 加 `#[serde(rename_all = "camelCase")]`、`Book.next_season_id` 单字段
//! `#[serde(rename = "nextSeasonId")]` 的契约。改其中一个属性就让本测试失败。

use serde::{Deserialize, Serialize};

// 镜像 types.rs 的 `SeasonInfo`。如果 types.rs 改了，本测试也要同步改——
// 这正是"两端键名同源"检查清单的一部分（见 docs/dev-notes.md 2026-09 同主题条目）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonInfo {
    pub number: u32,
    pub episode_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

// 镜像 types.rs 的 `EpisodeRecord`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRecord {
    pub watched: bool,
    #[serde(default)]
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamps: Option<Vec<TimeStamp>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeStamp {
    pub id: String,
    pub start: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<u32>,
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

// 镜像 types.rs 的 `Book`（仅字段对齐 serde 行为，类型用占位；本测试只关心
// `next_season_id` ↔ `nextSeasonId` 和 `prev_season_id` ↔ `prevSeasonId` 这两个字段的 rename）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct BookLite {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "nextSeasonId")]
    pub next_season_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "prevSeasonId")]
    pub prev_season_id: Option<String>,
}

/// 1. renderer payload（TS 风格 camelCase）反序列化进 `Vec<SeasonInfo>` 应该成功。
///
/// TS 源码（`apps/book-tracker/src/renderer/lib/api.ts`）：
/// ```ts
/// seasonsSet: (id, seasons) => invoke<Book>('books_seasons_set', { id, seasons })
/// ```
/// TS 类型（`apps/book-tracker/src/shared/types.ts`）：
/// ```ts
/// interface SeasonInfo { number: number; episodeCount: number; notes?: string; lastModified?: number }
/// ```
#[test]
fn seasons_render_payload_should_deserialize() {
    let payload = r#"{"seasons":[{"number":1,"episodeCount":25,"lastModified":1730000000000}]}"#;
    let value: serde_json::Value = serde_json::from_str(payload).unwrap();
    let seasons_value = value.get("seasons").unwrap();
    let result: Result<Vec<SeasonInfo>, _> = serde_json::from_value(seasons_value.clone());
    assert!(
        result.is_ok(),
        "renderer payload (camelCase) 应该能反序列化进 Vec<SeasonInfo>; got: {:?}",
        result.err()
    );
    let seasons = result.unwrap();
    assert_eq!(seasons.len(), 1);
    assert_eq!(seasons[0].number, 1);
    assert_eq!(seasons[0].episode_count, 25);
    assert_eq!(seasons[0].last_modified, Some(1730000000000));
}

/// 2. Rust 端 `SeasonInfo { episode_count: 25 }` 序列化产物 JSON 应该含 `episodeCount` 字面量。
///
/// 镜像 BookDetail → EpisodesPanel 的回流：Rust 把 SeasonInfo 序列化成 JSON 送到
/// renderer。如果产物里还是 `"episode_count"`，TS `season.episodeCount` 就是 undefined。
#[test]
fn seasons_rust_serializes_camel_case() {
    let s = SeasonInfo {
        number: 1,
        episode_count: 25,
        notes: None,
        last_modified: None,
    };
    let json = serde_json::to_string(&s).unwrap();
    assert!(
        json.contains("\"episodeCount\":25"),
        "序列化产物应含 camelCase `episodeCount`; got: {json}"
    );
    assert!(
        !json.contains("episode_count"),
        "序列化产物**不应**含 snake_case `episode_count`(会与 TS 接口脱节); got: {json}"
    );
}

/// 3. `EpisodeRecord.lastModified` 时间戳应当从 camelCase payload 正确读回。
///
/// 修前：TS 发 `{"lastModified": 1730000000000}`，Rust `last_modified` 字段有
/// `#[serde(default)]` → 静默变成 `None`，用户写笔记的"最后修改时间"丢失。
#[test]
fn episode_record_round_trips_last_modified() {
    let payload = r#"{"watched":true,"note":"hello","lastModified":1730000000000}"#;
    let rec: EpisodeRecord = serde_json::from_str(payload).unwrap();
    assert_eq!(rec.last_modified, Some(1730000000000));

    let serialized = serde_json::to_string(&rec).unwrap();
    assert!(serialized.contains("\"lastModified\":1730000000000"));
}

/// 4. `Book.next_season_id` 应该序列化为 `nextSeasonId`。
///
/// 修前：Rust 出参 Book 里 `next_season_id` 是 snake_case，TS `book.nextSeasonId`
/// 永远是 undefined → BookDetail 的「下一季」字段永远显示"未设置"。
#[test]
fn book_next_season_id_serializes_as_camel_case() {
    let book = BookLite {
        id: "1".to_string(),
        title: "鉴证实录".to_string(),
        next_season_id: Some("5".to_string()),
        prev_season_id: None, // v1.6 起 BookLite 多了 prev_season_id 字段
    };
    let json = serde_json::to_string(&book).unwrap();
    assert!(
        json.contains("\"nextSeasonId\":\"5\""),
        "Book 出参应含 camelCase `nextSeasonId`; got: {json}"
    );
    assert!(
        !json.contains("next_season_id"),
        "Book 出参**不应**含 snake_case `next_season_id`; got: {json}"
    );

    // 镜像反向：TS 风格入参 `nextSeasonId` 应当能反序列化进 `BookLite`。
    let payload = r#"{"id":"1","title":"X","nextSeasonId":"5"}"#;
    let parsed: BookLite = serde_json::from_str(payload).unwrap();
    assert_eq!(parsed.next_season_id.as_deref(), Some("5"));
}

/// 5. `Book.prev_season_id` 应该序列化为 `prevSeasonId`(v1.6 新增,与 next_season_id 同款)。
///
/// 双向同步策略:`prev_season_id` 由 service 层在 set_next_season 路径自动维护,
/// 不暴露 IPC 命令。BookDetail「上一季」区块直接从 book.prevSeasonId 读,
/// 渲染时跟 nextSeasonId 对称。
/// 修前:Rust 出参 Book 里 `prev_season_id` 是 snake_case,TS `book.prevSeasonId` 永远是 undefined,
/// BookDetail 的「上一季」字段永远显示"未设置"(即使数据层已正确双向同步)。
#[test]
fn book_prev_season_id_serializes_as_camel_case() {
    let book = BookLite {
        id: "2".to_string(),
        title: "鉴证实录 S02".to_string(),
        next_season_id: None,
        prev_season_id: Some("1".to_string()),
    };
    let json = serde_json::to_string(&book).unwrap();
    assert!(
        json.contains("\"prevSeasonId\":\"1\""),
        "Book 出参应含 camelCase `prevSeasonId`; got: {json}"
    );
    assert!(
        !json.contains("prev_season_id"),
        "Book 出参**不应**含 snake_case `prev_season_id`; got: {json}"
    );

    // 镜像反向:TS 风格入参 `prevSeasonId` 应当能反序列化进 `BookLite`。
    let payload = r#"{"id":"2","title":"X","prevSeasonId":"1"}"#;
    let parsed: BookLite = serde_json::from_str(payload).unwrap();
    assert_eq!(parsed.prev_season_id.as_deref(), Some("1"));

    // 同时含 next + prev(完整季链节点)→ 都序列化
    let full = BookLite {
        id: "2".to_string(),
        title: "Y".to_string(),
        next_season_id: Some("3".to_string()),
        prev_season_id: Some("1".to_string()),
    };
    let full_json = serde_json::to_string(&full).unwrap();
    assert!(full_json.contains("\"nextSeasonId\":\"3\""));
    assert!(full_json.contains("\"prevSeasonId\":\"1\""));
    assert!(!full_json.contains("next_season_id"));
    assert!(!full_json.contains("prev_season_id"));
}