//! 跨进程共享类型定义 —— Rust 端镜像(serde)。
//!
//! 与 `src/shared/types.ts` 1:1 对应。前端用 .ts 版本,Rust 端用 .rs 版本,
//! 二者通过 IPC JSON 通信时字段名 / 值完全一致。
//!
//! 设计原则:
//! - `snake_case` 序列化(TS 字段已是 snake_case,如 `read_count`)
//! - 枚举用 snake_case 字符串(`want` / `shelved` / `any_of` 等)
//! - 可选字段用 `Option<T>`;表示"显式置空"的语义用 `Option<Option<T>>`(见 BookPatch.progress)
//! - ISO 8601 时间戳用 `String`(避免 chrono 等外部依赖)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 阅读状态。`'want' | 'shelved' | 'reading' | 'finished' | 'abandoned'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookStatus {
    Want,
    Shelved,
    Reading,
    Finished,
    Abandoned,
}

/// 章节进度。`{ current: u32, total: u32 | null }`
/// `total = null` 表示连载中 / 总章节未知。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    /// 当前已读到的章节数(≥0)
    pub current: u32,
    /// 总章节数;`null` = 连载中/未知
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
}

/// 一本书的完整结构(后端 ↔ 前端通信载体)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub country: String,
    /// 出版年份;`i32` 涵盖 BC(公元前负数)
    pub year: i32,
    pub translator: String,
    pub status: BookStatus,
    /// 第 N 次读;仅 `status == Reading` 时有意义
    pub read_count: u32,
    /// 章节进度;`None` = 未设置
    pub progress: Option<Progress>,
    /// ISO 8601 字符串
    pub created: String,
    /// ISO 8601 字符串
    pub updated: String,
    pub tags: Vec<String>,
}

/// 创建书的用户输入。`Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags'>`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookInput {
    pub title: String,
    pub author: String,
    pub country: String,
    pub year: i32,
    pub translator: String,
    pub status: BookStatus,
    pub progress: Option<Progress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// 更新书的 patch(全字段可选)。
///
/// `progress` 用 `Option<Option<Progress>>` 区分三种语义:
/// - `None` → 不修改
/// - `Some(None)` → 显式清空(置 null)
/// - `Some(Some(p))` → 设置为 p
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BookPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<BookStatus>,
    /// 三态:`None` = 不改 / `Some(None)` = 清空 / `Some(Some(p))` = 设值
    #[serde(default, deserialize_with = "double_option")]
    pub progress: Option<Option<Progress>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// 自定义反序列化:让 `Option<Option<T>>` 区分"字段不存在"和"字段为 null"。
///
/// serde 默认会把 `null` 吞成 `None`,这样 `Option<Option<T>>` 就退化成 `Option<T>` 了。
/// 这个函数强制把 null 解析为 `Some(None)`。
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// 解锁规则。`'all' | 'any_of'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnlockRule {
    All,
    AnyOf,
}

/// 一条前置边:目标书 `to` 需要 `prerequisites` 中若干本已读
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub to: String,
    pub prerequisites: Vec<String>,
    pub rule: UnlockRule,
    /// 仅 `rule == AnyOf` 时使用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<u32>,
}

/// `relations.json` 文件结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationsFile {
    pub version: u32,
    pub edges: Vec<Edge>,
}

/// 应用配置(数据目录自带)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    /// 用户数据根目录(绝对路径)
    pub data_dir: String,
    pub language: String,
    pub default_mode: DefaultMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Clean,
    Edit,
}

/// `computeUnlocked` 的返回结构
#[derive(Debug, Clone)]
pub struct UnlockResult {
    /// `id → 是否解锁`
    pub unlocked: HashMap<String, bool>,
    /// 循环依赖涉及到的节点列表(每个环一组)
    pub cycles: Vec<Vec<String>>,
}
