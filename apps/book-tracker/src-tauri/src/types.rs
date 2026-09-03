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

/// 单季元信息 —— 仅 `kind === 'tv' | 'anime'` 时有意义（v1.2 集笔记功能配套字段）。
/// - `number`: 季号(1-based)
/// - `episode_count`: 该季总集数
/// - `notes`: 该季整体笔记(可选;空串 → 不写盘)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonInfo {
    pub number: u32,
    pub episode_count: u32,
    /// 季笔记 —— `serde(default)` 让老数据缺字段也能反序列化成 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// 单集时间戳笔记 —— 出现在 `EpisodeRecord.stamps` 数组里（v1.3 新增）。
///
/// 用途：用户看剧时手动标"开始时间 [→ 结束时间] 描述"的片段笔记,
/// 例如 `00:32:15 - 00:35:40 高潮追车`。`end` 可选 —— 单时间点 = "这一刻",
/// 时间段 = "这段场景"。
///
/// 时间统一用**秒**存（避免 mm:ss/hh:mm:ss 在 UI 切换时反复解析、跨平台格式不一致）。
/// UI 输入框解析 `mm:ss` / `hh:mm:ss` / `ss` 三种人类格式,写入前转成秒;
/// 展示时再格式化为 `mm:ss` / `hh:mm:ss`,保证 Rust 端只面对纯数字。
///
/// `id` 是稳定 UUID(由前端 `crypto.randomUUID()` 生成),用于编辑 / 删除单条时定位;
/// 跟同条目的 sort 顺序无关 —— 后端读时按 `start` 升序排序后返回。
///
/// 写盘策略:stamps 数组为空 → 不写字段(继承 EpisodeRecord 的"最稀疏"语义)。
/// 老数据缺字段 → None(向后兼容,`parse_episodes` 容错)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeStamp {
    /// 稳定 UUID —— 用于编辑 / 删除定位
    pub id: String,
    /// 开始时间(秒;非负整数;0 允许表示"开场")
    pub start: u32,
    /// 结束时间(秒;可选 —— 单时间点 vs 时间段)
    /// `serde(default)` 让老数据缺字段反序列化成 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<u32>,
    /// 笔记内容
    pub note: String,
}

/// 单集记录 —— 出现在 `Book.episodes` 稀疏 map 里（v1.2 新增,v1.3 加 stamps 字段）。
/// - `watched`: 该集是否已看(允许乱序)
/// - `note`: 该集笔记(空串也允许,语义 = "清空笔记")
/// - `title`: 该集标题(可选;空串 → 不写盘)
/// - `stamps`: 该集时间戳笔记数组(v1.3 新增;空数组 → 不写盘)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeRecord {
    pub watched: bool,
    #[serde(default)]
    pub note: String,
    /// 集标题 —— `serde(default)` 让老数据缺字段也能反序列化成 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 时间戳笔记数组 —— `serde(default)` 让老数据缺字段反序列化成 `None`;
    /// 写盘时由 `data/books.rs::persist` 判断"非空才写"（最稀疏策略）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamps: Option<Vec<TimeStamp>>,
}

/// 单集稀疏 map —— key = `"${season}-${episode}"`,如 "1-3" = S01E03。
/// 用 BTreeMap 而不是 HashMap 是为了:序列化顺序稳定（key 字典序）,
/// 方便 frontmatter diff / git diff 友好,也让 renderer 端按集号遍历时更可预期。
pub type EpisodeNotes = std::collections::BTreeMap<String, EpisodeRecord>;

/// 把 season + episode 拼成 EpisodeNotes key(与 TS 端 `episodeKey` 同源语义)。
pub fn episode_key(season: u32, episode: u32) -> String {
    format!("{}-{}", season, episode)
}

/// 把 EpisodeNotes key 拆回 (season, episode)。拆分失败 → None。
pub fn parse_episode_key(key: &str) -> Option<(u32, u32)> {
    let idx = key.find('-')?;
    if idx == 0 || idx == key.len() - 1 {
        return None;
    }
    let s: u32 = key[..idx].parse().ok()?;
    let e: u32 = key[idx + 1..].parse().ok()?;
    if s < 1 || e < 1 {
        return None;
    }
    Some((s, e))
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
    /// 季信息数组 —— 仅 `kind === 'tv' | 'anime'` 时有意义(v1.2 集笔记配套)。
    /// `serde(default)` 让老数据缺字段 → `None`(向后兼容);写盘策略由 data 层判定(空数组不写)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seasons: Option<Vec<SeasonInfo>>,
    /// 单集稀疏 map —— 仅 `kind === 'tv' | 'anime'` 时有意义(v1.2 新增)。
    /// `serde(default)` 让老数据缺字段 → `None`(向后兼容);写盘策略由 data 层判定(空 map 不写)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episodes: Option<EpisodeNotes>,
}

/// 创建作品的用户输入。`Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags' | 'episodes'>`
///
/// `episodes` 不在 BookInput 里 —— 单集笔记是详情页独占编辑的,不在加作品表单出现。
/// `seasons` 保留在 BookInput(季结构是创建作品时确定的)。
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
    /// 季信息数组(可选;tv/anime 用)—— 创建时由表单传入;改 kind 后允许后续 patch 补
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seasons: Option<Vec<SeasonInfo>>,
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
    /// 季信息数组 —— `None` 不改,`Some(vec![])` 清空（语义 = "这部作品去掉季记录"）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seasons: Option<Vec<SeasonInfo>>,
    /// 单集稀疏 map —— `None` 不改,`Some(empty_map)` 清空（语义 = "清空所有集笔记"）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episodes: Option<EpisodeNotes>,
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
    /// 视觉主题预设(`"classic" | "library" | "codex"`)—— 缺省/无效值 fallback classic
    #[serde(default)]
    pub theme: String,
    /// 信息呈现格式(`"list" | "grid" | "focus-stack"`)—— 与 theme 正交,缺省 fallback list
    #[serde(default)]
    pub format: String,
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
