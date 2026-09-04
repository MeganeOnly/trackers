//! book 业务逻辑 —— 包装 data/books,加容错和 ID 复用。

use std::collections::HashSet;
use std::path::Path;

use tracker_core::frontmatter::now_iso;

use crate::data::books as data;
use crate::types::{episode_key, parse_episode_key, Book, BookInput, BookPatch, CharacterNotes, EpisodeNotes, EpisodeRecord, SeasonInfo, TimeStamp};

/// 列出所有书 + 损坏列表。
pub fn list_books(books_dir: impl AsRef<Path>) -> std::io::Result<data::BookListResult> {
    data::read_all_books(books_dir)
}

/// 读取一本书。
pub fn get_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Book>> {
    data::read_book(books_dir, id)
}

/// 创建一本书 —— 自动分配新 ID。
pub fn create_book(books_dir: impl AsRef<Path>, input: &BookInput) -> std::io::Result<Book> {
    let ids: HashSet<String> = data::list_book_ids(&books_dir)?.into_iter().collect();
    data::write_book(&books_dir, input, &ids)
}

/// 更新一本书 —— patch 合并。
pub fn update_book(books_dir: impl AsRef<Path>, id: &str, patch: &BookPatch) -> std::io::Result<Book> {
    data::update_book(books_dir, id, patch)
}

/// 快速调整 progress。
pub fn bump_progress(books_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Book> {
    data::bump_progress(books_dir, id, delta)
}

/// 删除一本书。
pub fn delete_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    data::delete_book(books_dir, id)
}

// ==================== v1.2 集笔记业务方法 ====================

/// 整段替换季信息。`seasons` 为空 Vec → 清空（等同 patch 语义）。
pub fn set_seasons(books_dir: impl AsRef<Path>, id: &str, seasons: Vec<SeasonInfo>) -> std::io::Result<Book> {
    let patch = BookPatch {
        seasons: Some(seasons),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

/// 切换单集 `watched` 标记。
/// - 标记 watched=true 的集若原本不存在 → 新建(key 持久存在,note/title 留空)
/// - 标记 watched=false 的集若 note/title 均为空 → 删 key(最稀疏)
/// - 若只剩 watched=false 一项 → 删 key
pub fn set_episode_watched(
    books_dir: impl AsRef<Path>,
    id: &str,
    season: u32,
    episode: u32,
    watched: bool,
) -> std::io::Result<Book> {
    let existing = data::read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let key = episode_key(season, episode);
    let mut episodes: EpisodeNotes = existing.episodes.clone().unwrap_or_default();
    if watched {
        // watched=true: 写 key(可能新建),保留旧 note/title/stamps
        // v1.5:watched toggle 不刷 last_modified(用户期望"什么都没改,老时间不变")
        let entry = episodes.entry(key).or_insert_with(|| EpisodeRecord {
            watched: false,
            note: String::new(),
            title: None,
            stamps: None,
            last_modified: None,
        });
        entry.watched = true;
    } else {
        // watched=false: 仅在该集没有 note/title/stamps 时删 key(否则保留条目,watched=false)
        if let Some(entry) = episodes.get_mut(&key) {
            entry.watched = false;
            let has_note = !entry.note.is_empty();
            let has_title = entry.title.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
            let has_stamps = entry.stamps.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            if !has_note && !has_title && !has_stamps {
                episodes.remove(&key);
            }
        }
    }
    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

/// 设置单集笔记。空串 → 删 key(决策 4 = 最稀疏)。
/// 已存 watched/title 时也照样删 key(因为该集没有任何有意义的字段了)。
///
/// v1.5 起:`last_modified`(毫秒;Option<u64>)为 Some(非 0)时刷该集 `last_modified` 字段;
/// 仅当 `note` 非空(实际写入笔记内容)时才刷 —— 空串"删笔记"是结构变更,不该刷时间戳。
pub fn set_episode_note(
    books_dir: impl AsRef<Path>,
    id: &str,
    season: u32,
    episode: u32,
    note: String,
    last_modified: Option<u64>,
) -> std::io::Result<Book> {
    let existing = data::read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let key = episode_key(season, episode);
    let mut episodes: EpisodeNotes = existing.episodes.clone().unwrap_or_default();
    if note.is_empty() {
        // 仅在该集没有 title / stamps 时才删 key;否则保留 key(note 字段由后续 set 触发写盘时省略)
        if let Some(entry) = episodes.get(&key) {
            let has_title = entry.title.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
            let has_stamps = entry.stamps.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            let has_watched = entry.watched;
            if !has_watched && !has_title && !has_stamps {
                episodes.remove(&key);
            } else {
                if let Some(e) = episodes.get_mut(&key) {
                    e.note = String::new();
                    // v1.5:空串 = 清空笔记 → 不刷 last_modified(用户期望"什么都没改,老时间不变")
                }
            }
        }
    } else {
        let entry = episodes.entry(key).or_insert_with(|| EpisodeRecord {
            watched: false,
            note: String::new(),
            title: None,
            stamps: None,
            last_modified: None,
        });
        entry.note = note;
        // v1.5:实际写入笔记内容时刷 last_modified
        if let Some(ts) = last_modified {
            if ts > 0 {
                entry.last_modified = Some(ts);
            }
        }
    }
    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

/// 设置单集标题。空串 → 删 title 字段(保留 key 当 watched/note 还有数据时)。
/// 若 watched=false 且 note 空且 title 被删 → 整个 key 删(最稀疏)。
///
/// v1.5 起:`last_modified`(毫秒;Option<u64>)为 Some(非 0)且 title 非空时刷;
/// 空串"删 title"不刷时间戳。
pub fn set_episode_title(
    books_dir: impl AsRef<Path>,
    id: &str,
    season: u32,
    episode: u32,
    title: String,
    last_modified: Option<u64>,
) -> std::io::Result<Book> {
    let existing = data::read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let key = episode_key(season, episode);
    let mut episodes: EpisodeNotes = existing.episodes.clone().unwrap_or_default();
    if title.is_empty() {
        // 仅删 title 字段,不动 key
        if let Some(entry) = episodes.get_mut(&key) {
            entry.title = None;
            let has_stamps = entry.stamps.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            if !entry.watched && entry.note.is_empty() && !has_stamps {
                episodes.remove(&key);
            }
        }
    } else {
        let entry = episodes.entry(key).or_insert_with(|| EpisodeRecord {
            watched: false,
            note: String::new(),
            title: None,
            stamps: None,
            last_modified: None,
        });
        entry.title = Some(title);
        if let Some(ts) = last_modified {
            if ts > 0 {
                entry.last_modified = Some(ts);
            }
        }
    }
    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

/// 清空整部剧的所有 episodes(map 整体置 None → 稀疏不写盘)。
pub fn clear_episodes(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Book> {
    let patch = BookPatch {
        episodes: Some(EpisodeNotes::new()),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

/// 进度 +1/-1 联动集笔记。
/// - `delta > 0`: progress.current += delta;线性遍历 seasons 找下一个 unwatched,标 watched=true;
///   标记数 = min(delta, 剩余未看数)
/// - `delta < 0`: progress.current -= |delta|;不动 episodes(允许用户保留笔记)
/// - 当 book 没有 seasons / 进度信息时,只动 progress.current(老路径)
pub fn episode_bump(books_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Book> {
    let mut book = data::bump_progress(&books_dir, id, delta)?;
    if delta <= 0 {
        return Ok(book);
    }
    // delta > 0: 联动标记 watched
    let seasons = match book.seasons.as_ref() {
        Some(s) if !s.is_empty() => s.clone(),
        _ => return Ok(book),
    };
    let mut episodes: EpisodeNotes = book.episodes.clone().unwrap_or_default();
    let mut remaining = delta as u32;
    // 线性遍历:季按 number 升序,集按 episode 升序
    let mut sorted_seasons: Vec<&SeasonInfo> = seasons.iter().collect();
    sorted_seasons.sort_by_key(|s| s.number);
    for s in sorted_seasons {
        if remaining == 0 {
            break;
        }
        for ep in 1..=s.episode_count {
            if remaining == 0 {
                break;
            }
            let key = episode_key(s.number, ep);
            // v1.5:episode_bump 是 watched 联动,不刷 last_modified
            let entry = episodes.entry(key).or_insert_with(|| EpisodeRecord {
                watched: false,
                note: String::new(),
                title: None,
                stamps: None,
                last_modified: None,
            });
            if !entry.watched {
                entry.watched = true;
                remaining -= 1;
            }
        }
    }
    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    book = data::update_book(books_dir, id, &patch)?;
    Ok(book)
}

/// 列出所有已 watched 的集(key 列表,按字典序)。供前端工具函数用。
#[allow(dead_code)]
pub fn watched_episodes(book: &Book) -> Vec<(u32, u32)> {
    book.episodes
        .as_ref()
        .map(|m| {
            m.iter()
                .filter(|(_, v)| v.watched)
                .filter_map(|(k, _)| parse_episode_key(k))
                .collect()
        })
        .unwrap_or_default()
}

/// 整体替换单集的时间戳笔记数组(v1.3 新增,v1.5 加 last_modified)。
///
/// 语义:
/// - `stamps = vec![]` → 等同"清空该集所有 stamp";若该集也没 watched / note / title → 删 key
/// - `stamps = non_empty` → 整体替换(不是 append),由前端先合并再传过来;
///   服务端按 `start` 升序重新排序(同 start 按 id 字典序),与前端 `sortStamps` 同步
///
/// v1.5:`last_modified`(毫秒;Option<u64>)为 Some(非 0)且 stamps 非空时刷该集时间戳;
/// 空 stamps("清空 stamp")不刷。
///
/// 服务端只做"读 → 改 → 写"三步,不做单条 stamp 级别的"add / update / delete"
/// (那都是前端组合:list → 改 → 整体传过来)。
pub fn set_episode_stamps(
    books_dir: impl AsRef<Path>,
    id: &str,
    season: u32,
    episode: u32,
    mut stamps: Vec<TimeStamp>,
    last_modified: Option<u64>,
) -> std::io::Result<Book> {
    let existing = data::read_book(&books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let key = episode_key(season, episode);
    let mut episodes: EpisodeNotes = existing.episodes.clone().unwrap_or_default();

    if stamps.is_empty() {
        // 空数组 = 清空 stamp;若该集没有任何字段了 → 删 key(最稀疏)
        if let Some(entry) = episodes.get_mut(&key) {
            entry.stamps = None;
            let has_note = !entry.note.is_empty();
            let has_title = entry.title.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
            if !entry.watched && !has_note && !has_title {
                episodes.remove(&key);
            }
        }
        // 该集原本就不存在 → 不创建空条目(空 stamps 不应创建 key)
    } else {
        // 非空 → 整体替换 + 排序(同 start 按 id 字典序)
        stamps.sort_by(|a, b| {
            if a.start != b.start {
                return a.start.cmp(&b.start);
            }
            a.id.cmp(&b.id)
        });
        let entry = episodes.entry(key).or_insert_with(|| EpisodeRecord {
            watched: false,
            note: String::new(),
            title: None,
            stamps: None,
            last_modified: None,
        });
        entry.stamps = Some(stamps);
        if let Some(ts) = last_modified {
            if ts > 0 {
                entry.last_modified = Some(ts);
            }
        }
    }

    let patch = BookPatch {
        episodes: Some(episodes),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

// ==================== v1.5 角色笔记业务方法 ====================

/// 整段替换角色笔记数组。`characters` 为空 Vec → 清空（等同 patch 语义）。
///
/// 稀疏写盘策略(由 data 层兜底):
/// - 空数组 → 不写 frontmatter
/// - 单条 character 的 `name` 空 → 跳过该条(脏数据防御)
/// - 单条 character 的 `notes` 空 → 不写 notes 字段,但保留 character 条目
/// - 单条 character 的 `last_modified` undefined / 0 → 不写字段
///
/// 前端在 IPC 前应主动过滤掉 `name` 空的条目;这里的过滤只是兜底(防御性)。
pub fn set_characters(
    books_dir: impl AsRef<Path>,
    id: &str,
    characters: CharacterNotes,
) -> std::io::Result<Book> {
    let patch = BookPatch {
        characters: Some(characters),
        ..Default::default()
    };
    data::update_book(books_dir, id, &patch)
}

// ==================== v1.6 「下一季」业务方法 ====================

/// 设置 / 清除「下一季」关联(v1.6 新增;仅 tv/anime 实际使用,其他类型也允许)。
///
/// - `next_season_id: None` → 清空(不写 frontmatter)
/// - `next_season_id: Some("")` → 也视为清空(空串语义同 None,跟 notes / starring 同款)
/// - `next_season_id: Some("42")` → 写 frontmatter `nextSeasonId: "42"`
///
/// 校验:
/// - 禁止 self-loop(id 跟 next_season_id 相同 → Err)
/// - next_season_id 引用的目标 book 是否存在 —— **不在这里硬拒绝**写盘,
///   允许"目标被删除"的脏数据被存下,由前端 UI 兜底提示「原作品已删除 [× 移除]」。
///
/// **v1.6 双向同步**：设置 A.nextSeasonId = B 时,自动:
/// 1. 清理 A 旧的 nextSeasonId —— 若之前指向 C(且 C != B),则 C.prevSeasonId 也要清掉(C 不再是 A 的下一季)
/// 2. 清理 B 旧的 prevSeasonId —— 若之前指向 D(且 D != A),则 D.nextSeasonId 也要清掉(D 不再是 B 的上一季)
/// 3. 设置 A.nextSeasonId = B
/// 4. 若 B 实际存在(B 文件能 read),设置 B.prevSeasonId = A
///
/// 实现细节:`next_season_id` 不在 BookPatch 里(跟 seasons / episodes / characters 同款,
/// 关联字段走专用 IPC),所以不走 update_book patch 路径 —— 直接 read → 改 merged → 调
/// `data::books::persist`(pub(crate))。这样保证 updated 时间戳刷新、原子写、所有其他字段不变。
///
/// 清理旧关联用 `persist`,但**不刷新** updated 时间戳 —— 清理脏引用是结构性维护,
/// 不是用户主动编辑。详细策略见 AGENTS.md §十。<新增条目>v1.6 双向同步。
pub fn set_next_season(
    books_dir: impl AsRef<Path>,
    id: &str,
    next_season_id: Option<String>,
) -> std::io::Result<Book> {
    // 校验:self-loop 拒绝
    if let Some(nid) = &next_season_id {
        if !nid.is_empty() && nid == id {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "下一季不能指向自己",
            ));
        }
    }
    let books_dir = books_dir.as_ref();
    let existing = data::read_book(books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let normalized: Option<String> = next_season_id.and_then(|s| if s.is_empty() { None } else { Some(s) });

    // ---- 双向同步 ----
    // 1. 清理 A 旧的 next 关联 —— 若 A 之前指向 C(且 C != 新 next,可能是 None 或别的),
    //    那么 C 不再是 A 的下一季,C.prev_season_id 要清掉(否则 C.prev 反向指向"不存在的下一季")
    let old_next = existing.next_season_id.clone();
    if let Some(old_cid) = &old_next {
        // "旧 next 是 C" 且 "新 next 不是 C"(即真在改 / 清,不是 no-op)
        if normalized.as_deref() != Some(old_cid.as_str()) {
            if let Some(mut c) = data::read_book(books_dir, old_cid)? {
                // 只在 C.prev == A.id 时清(防御:C 可能已经被别的链路重写过)
                if c.prev_season_id.as_deref() == Some(id) {
                    c.prev_season_id = None;
                    // 清理脏引用,不是用户主动编辑 → 不刷 updated
                    crate::data::books::persist(books_dir, &c)?;
                }
            }
            // 旧 next 指向不存在的 book → 那边的 prev 反正读不到,不需要清理
        }
    }

    // 2. 清理 B 旧的 prev 关联(仅当新 next 是有效 book 时) —— 若 B 之前指向 D(且 D != A),
    //    那么 D 不再是 B 的上一季,D.next_season_id 要清掉
    if let Some(new_nid) = &normalized {
        if let Some(mut b) = data::read_book(books_dir, new_nid)? {
            let old_prev = b.prev_season_id.clone();
            if let Some(old_did) = &old_prev {
                if old_did != id {
                    // D != A:把 D.next 清掉(D 不再是 B 的上一季)
                    if let Some(mut d) = data::read_book(books_dir, old_did)? {
                        if d.next_season_id.as_deref() == Some(new_nid) {
                            d.next_season_id = None;
                            crate::data::books::persist(books_dir, &d)?;
                        }
                    }
                }
            }
            // 3. 设置 B.prev_season_id = A.id
            b.prev_season_id = Some(id.to_string());
            // 同步 prev 是结构性维护 → 不刷 B 的 updated(否则会让用户觉得"我什么都没改却被动了")
            crate::data::books::persist(books_dir, &b)?;
        }
        // B 不存在(被删/脏引用):跳过 prev 设置,前端 UI 兜底提示
    }

    let mut merged = existing;
    merged.next_season_id = normalized;
    merged.updated = now_iso();
    crate::data::books::persist(books_dir, &merged)?;
    Ok(merged)
}

// ==================== v1.7 「所属系列」业务方法 ====================

/// 设置 / 清除「所属系列」(v1.7 新增;无序收藏夹分组)。
///
/// - `series_id: None` → 清空(不写 frontmatter)
/// - `series_id: Some("")` → 也视为清空(空串语义同 None,跟 notes / starring 同款)
/// - `series_id: Some("42")` → 写 frontmatter `seriesId: "42"`
///
/// 校验:
/// - 目标 series 是否存在 —— **不在这里硬拒绝**写盘,
///   允许"目标被删除"的脏数据被存下(跟 v1.6 set_next_season 同款精神:
///   用户原意是显式的,不擅自重写)。前端 UI 兜底"该系列已删除"提示。
///
/// **联动 `updated`**:与 set_next_season 同款 —— 走 `persist` 路径,
/// 用户编辑关联字段会刷 updated 时间戳(语义对齐 = 用户一致预期)。
/// 不像 nextSeasonId 的"清理脏引用"那样不刷 updated(那是结构性维护),
/// 这里用户**主动**调 IPC,本身就是编辑动作。
///
/// **实现细节**:`series_id` 不在 BookPatch 里(跟 next_season_id 同款,
/// 关联字段走专用 IPC),所以不走 update_book patch 路径 —— 直接 read → 改 merged
/// → 调 `data::books::persist`(pub(crate))。这样保证原子写、所有其他字段不变。
pub fn set_series(
    books_dir: impl AsRef<Path>,
    id: &str,
    series_id: Option<String>,
) -> std::io::Result<Book> {
    let books_dir = books_dir.as_ref();
    let existing = data::read_book(books_dir, id)?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("book not found: {id}")))?;
    let normalized: Option<String> = series_id.and_then(|s| if s.is_empty() { None } else { Some(s) });
    let mut merged = existing;
    merged.series_id = normalized;
    merged.updated = now_iso();
    crate::data::books::persist(books_dir, &merged)?;
    Ok(merged)
}
