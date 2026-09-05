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
/// - `last_modified`: 该季笔记最后修改时间(毫秒;v1.5 起,仅 notes 被改时刷新;
///   number / episode_count 变化不刷 —— 季结构变更 ≠ 笔记内容变更)
///
/// **IPC 字段名**：`#[serde(rename_all = "camelCase")]` —— TS 端 `SeasonInfo`
/// 用 camelCase (`episodeCount` / `lastModified`),Tauri 2 的 `#[tauri::command]`
/// 宏只对**顶层参数**做 snake ↔ camel 转换,嵌套 struct 字段仍走 serde 默认,
/// 不加 rename_all 会导致 `books_seasons_set` IPC payload 直接被拒(报
/// "missing field `episode_count`")。文件格式不受影响(persist / parse_seasons
/// 手写 JSON,不经过 serde)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonInfo {
    pub number: u32,
    pub episode_count: u32,
    /// 季笔记 —— `serde(default)` 让老数据缺字段也能反序列化成 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// 该季笔记最后修改时间 —— `serde(default)` 老数据缺字段 → `None`;
    /// 写盘时由 data 层判定:Some(非 0)才写。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
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
/// 老数据缺字段 → None(向后兼容,`parse_stamps` 容错)。
///
/// **`last_modified` 是 per-row 跟踪**(v1.6 修正)—— 每个 stamp 独立的"最后
/// 修改时间",与 v1.5 `Character.last_modified` 同款语义。StampList 编辑单条
/// 时构造新数组,对被改的 stamp 刷 `last_modified = Date.now()`;其他 stamp
/// 原值保持。**与 `EpisodeRecord.last_modified` 解耦** —— 后者只反映该集
/// note / title 改动,不被 stamp 改动触发(避免"改了某条 stamp → 整个 episode
/// 的最后修改时间被刷新"的混淆)。
///
/// **IPC 字段名**:`#[serde(rename_all = "camelCase")]` 已生效(同 SeasonInfo /
/// EpisodeRecord / Character),所有字段 IPC 走 camelCase。`last_modified` →
/// `lastModified`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// 该 stamp 最后修改时间 —— `serde(default)` 老数据缺字段 → `None`;
    /// 写盘时由 data 层判定:Some(非 0)才写。
    /// 决策:仅 note / start / end 任一被用户改写时刷新;删除 stamp 不刷
    /// (条目已消失);新建 stamp 一次性设当前时间。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

/// 单集记录 —— 出现在 `Book.episodes` 稀疏 map 里（v1.2 新增,v1.3 加 stamps 字段）。
/// - `watched`: 该集是否已看(允许乱序)
/// - `note`: 该集笔记(空串也允许,语义 = "清空笔记")
/// - `title`: 该集标题(可选;空串 → 不写盘)
/// - `stamps`: 该集时间戳笔记数组(v1.3 新增;空数组 → 不写盘)
/// - `last_modified`: 该集笔记内容最后修改时间(毫秒;v1.5 起,
///   仅 note / title / stamps 任一被改时刷新;watched toggle 不刷)
///
/// **IPC 字段名**：`#[serde(rename_all = "camelCase")]` —— 同 `SeasonInfo`,
/// TS 端用 `lastModified`,不加 rename_all 会让 `last_modified` 字段(`#[serde(default)]`)
/// 静默吞掉 TS 传来的时间戳(不报错,但数据丢失)。详见 SeasonInfo 注释 +
/// `docs/dev-notes.md` 2026-09 同主题条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// 该集笔记内容最后修改时间 —— `serde(default)` 老数据缺字段 → `None`;
    /// 写盘时由 data 层判定:Some(非 0)才写。
    /// 决策:仅 note / title / stamps 任一被用户改写时刷新;
    /// watched toggle 是状态而非笔记内容,不刷。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
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

/// 角色笔记条目 —— 出现在 `Book.characters` 数组里（v1.5 新增）。
///
/// 用途：用户对一部作品里的"角色"（人物 / 主角 / 配角 / 阵营 / 组织……）做独立笔记。
/// 与 `EpisodeRecord` 对齐:稀疏写盘、lastModified 语义相同。
/// - `id`: 稳定 UUID —— 由前端生成,用于编辑 / 删除定位
/// - `name`: 角色名(必填;空字符串视为脏数据,IPC 前由前端过滤)
/// - `notes`: 角色笔记(可选;空串 → 不写盘,但保留 character 条目)
/// - `last_modified`: 该 character 最后修改时间(毫秒;仅 name / notes 任一被改时刷新)
///
/// **IPC 字段名**：`#[serde(rename_all = "camelCase")]` —— 同 SeasonInfo / EpisodeRecord,
/// TS 端用 `lastModified`,不加 rename_all 会让 `last_modified`(`#[serde(default)]`)
/// 静默吞掉 TS 传来的时间戳。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    /// 角色笔记 —— `serde(default)` 让老数据缺字段也能反序列化成 `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// 最后修改时间 —— `serde(default)` 老数据缺字段 → `None`;
    /// 写盘时由 data 层判定:Some(非 0)才写。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
}

/// 角色笔记数组 —— 出现在 `Book.characters`(v1.5 新增)。
///
/// 与 `EpisodeNotes` 不同:用 `Vec<Character>` 而不是 BTreeMap —— 角色顺序由用户决定
/// (添加顺序),不需要按 id 字典序排序。但 `Character` 内部仍携带稳定 id 用于编辑定位。
pub type CharacterNotes = Vec<Character>;

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
    /// 角色笔记数组 —— 所有类型都能用(v1.5 新增,不只是 tv/anime)。
    /// 例:书里的人物、电视剧角色、电影主角、组织 / 阵营——都可以列出来单独写。
    /// `serde(default)` 让老数据缺字段 → `None`(向后兼容);
    /// 写盘策略由 data 层判定:空数组 / 全是 name 空的 character 不写。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub characters: Option<CharacterNotes>,
    /// 「下一季」关联到另一部作品的 id(v1.6 新增;仅 tv/anime 实际使用)。
    /// 单向字段;语义 = 「这部作品的下一季是 `next_season_id` 那部 book」。
    /// 反向"谁的下季是本季"通过遍历所有 book 的 next_season_id 推断。
    /// 写盘策略:`Some(非空)` 才写,空串 / None 不写 frontmatter。
    /// 老文件缺字段 → `None`(向后兼容,`serde(default)`)。
    ///
    /// **IPC 字段名**：单字段 `#[serde(rename = "nextSeasonId")]` —— Book 顶层
    /// 不整体 `rename_all = "camelCase"`(会破坏 TS 端 `book.read_count` 等 8 处
    /// snake_case 访问);`nextSeasonId` 是 Book 中唯一需要 camelCase 的字段,
    /// 用单字段 rename 兜底。Tauri 2 宏顶层参数转换照旧处理 IPC 入参(`setNextSeason`
    /// 收到 `nextSeasonId` 自动转回 `next_season_id`),出参 Book 序列化为
    /// `nextSeasonId` 后 TS `book.nextSeasonId` 才有值。文件格式不受影响(persist
    /// 手写 `nextSeasonId` 字面量,见 data/books.rs)。
    ///
    /// **v1.6 双向同步**：当 A.nextSeasonId = B 时,service 层会自动设置 B.prevSeasonId = A,
    /// 并清理 A / B 的旧关联(若 A 之前指向 C,清 C.prevSeasonId;若 B 之前指向 D,清 D.nextSeasonId)。
    /// 这里只承载"基础字段"原子更新;关联字段走专用命令(`books_set_next_season`)便于
    /// 集中加校验 / 反向引用清理 / 关系图联动。
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "nextSeasonId")]
    pub next_season_id: Option<String>,
    /// 「上一季」关联到另一部作品的 id(v1.6 新增;与 `next_season_id` 配对)。
    /// 语义 = 「这部作品的上一季是 `prev_season_id` 那部 book」,即反向引用
    /// "谁的下季是本季"。
    ///
    /// **v1.6 决策**：本字段由 service 层在 `set_next_season` 路径上**自动维护**,
    /// 不暴露 BookPatch / 专用 IPC(用户不需要手动设 prevSeasonId,前后端都不让)。
    /// 老数据:之前没有 prevSeasonId 字段 → 读回 None(向后兼容)。
    ///
    /// 写盘策略:跟 `next_season_id` 同款 —— `Some(非空)` 才写,空串 / None 不写。
    /// IPC 字段名:跟 next_season_id 一致用单字段 `rename = "prevSeasonId"`。
    /// 文件格式:persist 手写 `prevSeasonId` 字面量。
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "prevSeasonId")]
    pub prev_season_id: Option<String>,
    /// 「所属系列」id(v1.7 新增;无序收藏夹分组)。
    ///
    /// 语义:这部作品属于 `series_id` 这个 Series 集合(同一系列下可能有电视剧 / 电影 /
    /// 原著小说 / 外传等多本作品)。**与 `next_season_id` 区分**:`next_season_id` 是
    /// "线性季链"(A 的下一季是 B);`series_id` 是"无序归组"(A 和 B 都属"大明王朝"
    /// 系列但没有先后关系)。两者可以共存(A 既在"大明王朝"系列里,next 又指向 S02)。
    ///
    /// **单向字段**:只有"作品 → 系列"方向;系列侧不维护"包含哪些作品"的反向引用
    /// (renderer 端从 books 全量扫一遍聚合即可)。**没有自动双向同步**(理由:系列
    /// 是无序容器,无需 prev/next 概念)。
    ///
    /// **不联动 `updated`**:系列是被动的容器,改了它不该刷作品自身的 updated(用户会
    /// 觉得"我什么都没改却被动了")。
    ///
    /// 写盘策略:同 `next_season_id` —— `Some(非空)` 才写 frontmatter,空串 / None
    /// 不写;老文件缺字段 → None(向后兼容,`serde(default)`)。
    ///
    /// **不走 BookPatch**:改所属系列走专用 IPC `books_set_series`(跟
    /// `books_set_next_season` 同款;关联字段走专用命令便于将来加校验 / 系列删除时
    /// 的反向引用清理)。
    ///
    /// IPC 字段名:跟 next_season_id 一致用单字段 `rename = "seriesId"` —— Book 顶层
    /// 不整体 `rename_all = "camelCase"`。
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "seriesId")]
    pub series_id: Option<String>,
}

/// 创建作品的用户输入。`Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags' | 'episodes' | 'series_id'>`
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
    /// 所属系列 id(v1.7 新增)—— 创建时可填,允许直接归入已有系列。
    /// 缺省 / None / 空串 → 该作品不属于任何系列(等同"没设")。
    /// IPC 字段名:`#[serde(rename = "seriesId")]` —— 跟 Book.series_id 同款单字段 rename。
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "seriesId")]
    pub series_id: Option<String>,
    // 角色笔记数组(v1.5 起)—— 不在 BookInput 里;BookPatch.characters 由 set_characters 走专用 IPC。
    // 这里保留空缺:创建作品时不需要填角色笔记(详情页独占编辑)。
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
    /// 角色笔记数组(v1.5 新增)—— `None` 不改,`Some(empty_vec)` 清空
    /// (语义 = "清空所有角色笔记";空数组 / 全是 name 空的 character 由 data 层兜底不写 frontmatter)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub characters: Option<CharacterNotes>,
    // 注意:`next_season_id` 不在 BookPatch 里 —— 改下一季走专用 IPC `books_set_next_season`
    // (跟 seasons / episodes / characters 同款;BookPatch 只承载"基础字段"原子更新,
    // 关联字段走专用命令便于将来加校验 / 反向引用清理 / 关系图联动)。
    //
    // 注意:`series_id` 同样不在 BookPatch 里 —— 改所属系列走专用 IPC `books_set_series`
    // (理由同上)。
}

// ==================== v1.7 系列（Series）类型 ====================

/// 一个系列（v1.7 新增）—— 把多部相关作品归组（电视剧 + 衍生的电影 / 小说 / 外传等）。
///
/// **设计取舍**:
/// + 系列本身**只承载元信息**(id / name / notes / 时间戳),成员关系存放在各 book
///   的 `series_id` 字段(单向引用)。renderer 端从 books 全量扫一遍聚合即可获得
///   "某系列下所有作品",无需在 Series 实体里维护反向数组,避免双写一致性。
/// + **没有 `members` / `cover` / `description` 等额外字段**(v1.7 最小可用版);
///   `notes` 字段允许用户写系列简介(空串 = "无简介")。后续若需要封面 / 成员顺序 /
///   衍生分组,再加 v1.8 字段,不破坏现有数据(空缺字段 → None / 空)。
///
/// **与 nextSeasonId 的区别**:`next_season_id` 是"线性季链"(有方向、有先后),
/// `series_id` 是"无序归组"(只是收藏夹,无顺序、无方向)。两者共存不影响 —— A
/// 可以在某系列里,同时 nextSeasonId 指向 S02。
///
/// 写盘策略(由 `data::series::persist_series_file` 兜底):
/// + `name` 空串视为"无名称",**拒绝创建**(前端 IPC 前先校验;service 层也兜底)
/// + `notes` 空串 → 不写 frontmatter(同 Book.notes 策略)
/// + 老数据缺字段 → `serde(default)` 兜底为 None / 空
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub id: String,
    /// 系列名 —— 必填;前端校验非空
    pub name: String,
    /// 系列简介 —— 可选;空串不写盘
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// 创建时间 ISO 8601
    pub created: String,
    /// 更新时间 ISO 8601
    pub updated: String,
}

/// 创建系列的用户输入 —— `name` 必填,`notes` 可选。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesInput {
    pub name: String,
    #[serde(default)]
    pub notes: String,
}

/// 更新系列 patch(全字段可选)。
/// - `name`: `None` 不改,`Some(s)` 写为 s(service 层校验非空)
/// - `notes`: `None` 不改,`Some("")` 清空,`Some(s)` 写为 s
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SeriesPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// `series.json` 文件结构(v1.7 新增)—— 单文件存所有 series。
///
/// `version` 字段:`serde(default)` 让老文件(没这字段)也能反序列化;统一为 1。
/// 字段缺损 / 类型错误 → 容错为默认值,不抛错(同 relations.json 容错策略)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesFile {
    #[serde(default = "default_series_version")]
    pub version: u32,
    /// 所有系列 —— 单数组存储(数量小,几百以内,无需分页)
    #[serde(default)]
    pub series: Vec<Series>,
}

fn default_series_version() -> u32 {
    1
}

impl Default for SeriesFile {
    fn default() -> Self {
        Self {
            version: 1,
            series: Vec::new(),
        }
    }
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
    /// 侧栏系列入口展示模式(v2.x 起;`"inline-row"` = 系列徽章插入到 status 分组顶部)。
    /// 后续可加更多模式(独立 section / chip 列表 等);空 / 未知值 fallback `inline-row`。
    #[serde(default)]
    pub sidebar_series_entry_mode: String,
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
