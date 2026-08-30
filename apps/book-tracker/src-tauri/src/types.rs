//! 跨进程共享类型定义 —— Rust 端镜像(serde)。
//!
//! 通用类型（Edge / Progress / RelationsFile / UnlockResult / UnlockRule / PairwiseResult / RankingFile）
//! 已抽到 `crates/tracker-core`（monorepo 共享内核），本文件只保留 Book 领域类型，
//! 并 re-export core 的通用类型（保持 `crate::types::Edge` 等引用不变）。
//!
//! 与 `src/shared/types.ts` 1:1 对应。前端用 .ts 版本，Rust 端用 .rs 版本，
//! 二者通过 IPC JSON 通信时字段名 / 值完全一致。

use serde::{Deserialize, Serialize};

// 通用类型：来自共享内核（crates/tracker-core）
pub use tracker_core::{Edge, PairwiseResult, Progress, RankingFile, RelationsFile, UnlockResult, UnlockRule};

/// 作品类型。`'book' | 'anime' | 'tv' | 'movie' | 'other'`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkKind {
    Book,
    Anime,
    Tv,
    Movie,
    Other,
}

impl WorkKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkKind::Book => "book",
            WorkKind::Anime => "anime",
            WorkKind::Tv => "tv",
            WorkKind::Movie => "movie",
            WorkKind::Other => "other",
        }
    }

    pub fn parse(s: Option<&str>) -> WorkKind {
        match s {
            Some("anime") => WorkKind::Anime,
            Some("tv") => WorkKind::Tv,
            Some("movie") => WorkKind::Movie,
            Some("other") => WorkKind::Other,
            _ => WorkKind::Book,
        }
    }
}

/// 作品的阅读/观看状态。`'want' | 'shelved' | 'reading' | 'watching' | 'finished' | 'abandoned'`
///
/// `watching`（在看）语义与 `reading`（在读）一致 —— 仅非电影类型在 UI 中可选,
/// 用来解决"看完后再看一遍"时 `reading`（在读）措辞尴尬的问题。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookStatus {
    Want,
    Shelved,
    Reading,
    Watching,
    Finished,
    Abandoned,
}

/// 一部作品的完整结构(后端 ↔ 前端通信载体)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    /// 作品类型（书 / 动画 / 电视剧 / 电影 / 其他）
    pub kind: WorkKind,
    pub author: String,
    pub country: String,
    /// 出版年份;`i32` 涵盖 BC(公元前负数)
    pub year: i32,
    pub translator: String,
    pub status: BookStatus,
    /// 第 N 次读;仅 `status` 是「进行中」(Reading/Watching) 时有意义
    pub read_count: u32,
    /// 章节进度;`None` = 未设置
    pub progress: Option<Progress>,
    /// 编辑模式侧栏收起：所有 status 都允许，从 EditMode 侧栏的 status 分组
    /// 移到底部『已收起』分组。纯展示，不影响 status / 解锁 / CleanMode 任何行为。
    pub collapsed: bool,
    /// ISO 8601 字符串
    pub created: String,
    /// ISO 8601 字符串
    pub updated: String,
    pub tags: Vec<String>,
    /// 用户笔记（自由写）。v1 用 `<textarea>` 直编辑 —— 写盘策略:空串不写 frontmatter,
    /// 避免污染;老文件缺字段 / `notes: ""` 都视为无笔记（向后兼容）。
    #[serde(default)]
    pub notes: String,
    /// 主演(影视专用)。仅 `kind === 'movie' | 'tv'` 时在 UI 表单暴露（位置与书的"译者"对称）——
    /// 写盘策略同 `notes` / `translator`:空串不写 frontmatter,老文件缺字段 → ""。
    #[serde(default)]
    pub starring: String,
    /// 编剧(影视专用)。仅 `kind === 'movie' | 'tv'` 时在 UI 表单暴露 —— 与 starring 同属影视主创字段,
    /// 但放在 form 上独立的 input 行(避免"主演 / 编剧"标签二义)。
    /// 写盘策略同 `starring`:空串不写 frontmatter,老文件缺字段 → ""。
    #[serde(default)]
    pub screenwriter: String,
}

/// 创建作品的用户输入。`Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags' | 'notes'>`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookInput {
    pub title: String,
    pub kind: WorkKind,
    pub author: String,
    pub country: String,
    pub year: i32,
    pub translator: String,
    pub status: BookStatus,
    pub progress: Option<Progress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 编辑模式侧栏收起（默认 false；create 时由表单传入）
    #[serde(default)]
    pub collapsed: bool,
    /// 用户笔记 —— 默认空串（无笔记）
    #[serde(default)]
    pub notes: String,
    /// 主演(影视专用) —— 默认空串（无主演）
    #[serde(default)]
    pub starring: String,
    /// 编剧(影视专用) —— 默认空串（无编剧）
    #[serde(default)]
    pub screenwriter: String,
}

/// 更新书的 patch(全字段可选)。
///
/// `progress` 用 `Option<Option<Progress>>` 区分三种语义:
/// - `None` → 不修改
/// - `Some(None)` → 显式清空(置 null)
/// - `Some(Some(p))` → 设置为 p
///
/// `notes` 与 progress 不同 —— 用 `Option<String>`（双层包装无意义）:
/// - `None` → 不改
/// - `Some(s)` → 写为 s（空串也允许,语义 = "清空笔记"）
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BookPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<WorkKind>,
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
    /// 编辑模式侧栏收起
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    /// 用户笔记 —— `None` 不改,`Some("")` 清空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// 主演 —— `None` 不改,`Some("")` 清空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starring: Option<String>,
    /// 编剧 —— `None` 不改,`Some("")` 清空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenwriter: Option<String>,
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

/// 应用配置(数据目录自带)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub version: u32,
    /// 用户数据根目录(绝对路径)
    pub data_dir: String,
    pub language: String,
    pub default_mode: DefaultMode,
    /// 新建作品的默认类型
    #[serde(default = "default_work_kind")]
    pub default_work_kind: WorkKind,
    /// 展示筛选："all" 或某个作品类型的字符串
    #[serde(default)]
    pub works_filter: String,
}

fn default_work_kind() -> WorkKind {
    WorkKind::Book
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Clean,
    Edit,
}
