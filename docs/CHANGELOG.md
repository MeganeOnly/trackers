# Changelog

> 双 tracker 应用共享内核的版本演进记录。每个 tag / 里程碑单独成段。
> 详细的"现象 → 根因 → 修复 → 教训"经验沉淀见 [`docs/dev-notes.md`](dev-notes.md)。

---

## v1（2026-08）

**首个稳定版本**。这个月从 book-tracker 单体抽出共享内核，长出 life-tracker，并迭代出四类核心能力 + GraphView 工程化 + 共享边界判定 + 经验沉淀体系。

### 核心能力

- **countable 任务**：`SimpleSpec.count` + `Goal.countable` + `isDone` 谓词参数化。可计数任务（如"发论文"）独立"完成次数"section，不受 status 限制；同一任务的不同完成次数可独立成 prereq（"B 完成 1 次 AND B 完成 2 次 OR C"）。
- **互斥规则**（`ExcludeSpec`）：disqualifies / satisfies 两类 effect。改写 done 谓词，让 target 节点在满足/不满足时呈现不同解锁色。
- **前置规格化**（`PrereqSpec`）：替换旧的 `rule+threshold+groups`，支持四类 spec —— simple（A 完成）、group（N 选 K）、count（A 完成 N 次）、exclude（互斥）。旧形态完全兼容。
- **GroupMember per-member count**（v3）：group 内不同 member 可带不同引用次数（`{id, count}`），与 `SimpleSpec.count` 对齐。

### GraphView 工程化

- **悬空 link 过滤**：`react-force-graph` 的 d3-force-link 在 link.source/target 找不到节点时抛 `Error: node not found`。两 app GraphView 都加 `validIds` 过滤，与 `computeUnlocked` 同步。
- **持续运动**：d3-force 的 charge/link/center 三种保守力平衡后净力为零，不会持续动。引入 `orbitForce`（恒定切向速度）+ 强斥力 + 交互感知 freeze，节点既持续流动又可拖动。
- **平行边去重**：countable 多 spec 致同 source→target 画 N 条平行边，把节点挤成团。`deriveLinks` 后置 `(source, target)` 去重，与解锁层解耦。
- **高亮钉中心 + drag-end 回中心**：`onNodeDragEnd` 重置 `fx/fy=0`，让"钉住"不变成"粘死"。

### 工程化

- **npm workspaces 迁移**：根 `package.json` 加 `"workspaces"`，4 个 node_modules 从 410 MB 砍到 140 MB（-66%），`npm install` 60s → <5s 增量。公共 devDeps（typescript / vite / vitest / @tauri-apps/cli / @types/* / gray-matter）上提到根，子目录不再各自装一份。
- **死代码清理**：删未引用的 store/selectors / Rust pass-through 包装 / book-tracker 假笔记 UI。
- **共享边界判定**：[`docs/shared-boundary.md`](shared-boundary.md) 维护三类清单（全共享 / 参数化共享 / 领域专属）+ v1~v3.1 变更记录 + 「待办」段。
- **经验沉淀体系**：[`docs/dev-notes.md`](dev-notes.md) 9 主题 25+ 条，每条"现象→根因→修复→教训"四段 + `[共享]`/`[单 app]` 标签。

### 稳定性

- **前置编辑环检测与后端对齐**：修「点了没反应」静默失败 —— renderer 检测任意环阻止写盘，与 Rust `set_relations` 行为一致。
- **PrereqEditor 删除 / persist 兜底**：specs 为空时不再让 `baseEdge.prerequisites` 兜底逻辑把删除的 id 写回；清除 / 删除操作互不误伤；旧裸 id → 新 specs 走并集保留。
- **relations 不变量校验**（v3.1）：新增 `validate` 模块（Rust + TS 1:1），check 同一个 `to` 只能有一条前置边 —— `compute_unlocked` 的 `to→Edge` 索引隐式依赖此不变量，破坏时静默丢前置。当前只告警不拒绝，避免历史数据一旦不合规就完全写不进去；收紧成硬拒绝只需把 app 层 `set_relations` 的告警改成 validate 闭包返回 `Some(msg)`。

### 测试 & 文档

- **测试**：228 vitest（55 core + 55 book + 118 life）+ 111 cargo test（80 tracker-core + 18 book + 13 life）= **339 个测试全绿**。
- **文档**：
  - `AGENTS.md`（monorepo onboarding）
  - `docs/shared-boundary.md`（共享边界 + 「待办」段）
  - `docs/dev-notes.md`（经验沉淀）
  - `docs/CHANGELOG.md`（本文件）
  - `docs/ROADMAP.md`（v2 候选方向）
  - `docs/user-guide.md`（用户上手指南）

### 数据兼容性

- relations.json 的旧 `rule+threshold+groups` 形态自动升级为 specs。
- `GroupSpec.members: string[]` 与 `[{id, count}]` 双向兼容。
- SimpleSpec 同 id 多次添加（不同 count 视为独立实例）。

### 标签

- `book-tracker-v1`
- `life-tracker-v1`

两 tag 同 commit hash（同 v1 节点），按 `.github/workflows/release.yml` 约定分派构建对应 app。

---

## v1.1（2026-08）：Theme system + 共享 UI 基座落地

**主题系统 + packages/tracker-ui 共享基座**。把当前样式当 `classic` 预设保留，新加两套差异化预设 `library`（book 特色）和 `codex`（life 特色），设置面板运行时切换。

### 新增能力

- **三套视觉预设**：
  - `classic` —— 保留当前 sage green + 系统字体 + 圆角样式，作为基础预设（默认）。
  - `library` —— book-tracker 特色：深森林绿 + Fraunces 衬线 + 方角 + hairline border + 印章 mechanic（`-2deg` 旋转）。
  - `codex` —— life-tracker 特色：朱砂红 + Fraunces + 方角 + 印章 mechanic（次要色用深绿，跟 library 反过来）+ deadline 提醒色（`deadline-soon` 橙红 / `deadline-overdue` 朱红）。
- **运行时切换**：设置面板的 theme picker（radio 卡片 + 色卡预览），点击立即生效（CSS 变量级联 < 1ms），保存到 `config.json`。两 app 都能切到任意预设（不强制默认）。
- **防 FOUC**：`index.html` 内联 inline script 从 `localStorage` 抢先设 `data-theme`，settings store hydrate 后用 `Config.theme`（权威）覆盖一次，首屏不闪。
- **签名元素 № NNN + StampChip**：跨 preset 通用（base.css 提供），组件代码后续可按需使用。

### 共享 UI 基座

- **`packages/tracker-ui`**：新增 npm workspace，提供 `Modal` / `StampChip` / `useTheme` / `applyTheme` / `normalizeTheme` / `THEME_META` 导出 + `base.css` + `themes/{classic,library,codex}.css`。
- **`Modal` 抽取**：两 app `components/Modal.tsx`（字节级相同的 53 行）→ 共享，改为 re-export from `@ui/Modal`，其它组件引用路径 `'./Modal'` 不变。
- **其它共享组件**（TopBar / GraphView / PrereqEditor）：差异较大本轮不抽，留 `docs/shared-boundary.md` 跟进。

### 持久化

- **`Config.theme`**：`'classic' | 'library' | 'codex'`（TS + Rust 镜像）；Rust 端 `normalize` + `set_config` 都按白名单过滤，垃圾值 fallback classic（两端单测 `invalid_theme_falls_back_to_classic` 覆盖）。

### 字体加载

- **Google Fonts CDN**（Fraunces + Inter + JetBrains Mono + `font-display: swap`），离线时回退到系统字体（Georgia / `-apple-system` / `ui-monospace`）。后续如需完全离线可改自托管 woff2 到 `renderer/public/fonts/`。

### 工程化

- **`vite.config.ts` + `vitest.config.ts` alias 数组化**：用 `[{ find, replacement }]` 替代 `{ '@': ... }` 对象形式，规避 Vite 5 对象形式对 `@` 开头的 find 偶发触发 `Cannot find package '@core'`。
- **TS typecheck / Rust test / vitest** 三端全绿。

### 共享范围

- 两 app 完全共享 theme system + 共享基座；store/settings.ts / components/SettingsPanel.tsx / src-tauri/src/{types,data/config,service/config}.rs 两 app 都改；新增 `invalid_theme_falls_back_to_classic` 单测各一份。

### 标签

- `book-tracker-v1.1`
- `life-tracker-v1.1`

两 tag 同 commit hash，按 release workflow 分派构建。

---

## v1.2（2026-08）：剧集笔记 + RANK 按季拆分

**剧集笔记 + 季结构 + 按季独立排名**。把单本书的「章节进度」模型升级成 tv/anime 的「季 + 单集笔记」模型；同时把 RANK 的候选粒度从 book 拆到 book × season，让不同季之间能独立排名。

### 数据模型

- **`SeasonInfo`**：单季元信息（`number` / `episodeCount` / 可选 `notes` 季笔记）
- **`EpisodeRecord`**：单集记录（`watched` / `note` / 可选 `title` 集标题）
- **`EpisodeNotes`**：单集稀疏 map，key = `${season}-${episode}` 字符串（如 `"1-3"` = S01E03）
- **`Book.seasons?: SeasonInfo[]`**：仅 tv/anime；空数组不写盘，老文件缺字段 → `undefined`
- **`Book.episodes?: EpisodeNotes`**：仅 tv/anime；最稀疏策略（watched=true / 有 note / 有 title 才占 key）
- **`BookInput`**：保留 `seasons`（创建时填），剔除 `episodes`（详情页独占）
- **`BookPatch`**：`seasons` / `episodes` 都是 `Option<Vec<_>>` / `Option<EpisodeNotes>`，`None` = 不改，`Some(empty)` = 清空

### 写盘策略（一致的最稀疏）

- `seasons`：空数组 / 全部字段缺 → 不写盘
- `episodes`：空 map → 不写盘；单集 key 存在但 `note=""` 且 `title=None` → 不写 `note` / `title` 字段
- 季数中途变化保留旧 episodes key（决策 B；不自动清理超出范围的 key）

### 加作品表单

- 仅 `kind === 'tv' | 'anime'` 时显示「季设置」区块
- 每行：`S0X` + 集数 input + 「集」单位 + 删除按钮
- 「+ 新增一季」自动推下一个季号
- 至少保留 1 季（只有 1 季时点删 = 把该季集数改 0，不是删除）
- 顶部实时显示总集数 = seasons 求和
- 提交时 `progress.total` 跟 seasons 总和自动同步（避免错位）

### 详情页「集笔记」面板

- 顶部统计：`已看 X / Y · N 条笔记` + `+1 集` / `-1 集` / `清空` 按钮
- 季选择器（用户要求放在底部上方）：
  - `◀ 上一季 / [S01][S02][S03] / 下一季 ▶`
  - 默认选中第一个未完全看完的季；全看完 = 最后一季
- 当前季信息条：`S0X · N 集 · 已看 a/b`
- 集网格：`auto-fill minmax(48px, 1fr)`，每格显示集号 + ✓（已看）+ 右下点（有笔记）
  - 单击 → 展开内联编辑器（单格互斥）
  - 双击 → 快速 toggle watched
- 展开区：
  - 标题 input（可选，debounce 500ms 写盘）
  - 「已看」checkbox
  - 笔记 textarea（debounce 500ms；空串 → 删 key）
  - 「删除此集记录」一键清零（watched=false → 空 note → 空 title）

### IPC 命令（7 个新增 + lib.rs 注册）

- `books_seasons_set(id, seasons)` —— 整段替换季信息
- `books_episode_set_watched(id, season, episode, watched)` —— 切换单集 watched
- `books_episode_set_note(id, season, episode, note)` —— 写单集笔记（空串 → 删 key）
- `books_episode_set_title(id, season, episode, title)` —— 写单集标题（空串 → 删 title 字段）
- `books_episodes_clear(id)` —— 清空整部剧
- `books_episode_bump(id, delta)` —— progress +1/-1 联动集笔记（+1 标记下一个未看；-1 不动 episodes）
- `books_episodes_set(id, episodes)` —— 整体替换（v1.2 UI 不直接调用，留作 batch）

### RANK 按季拆分

- 新增 `expandRankingPool(books, kind)`：tv/anime 按季拆为 rank candidate；其他 kind 一本书一项
- rank ID 扩展：`book.id` 或 `"${book.id}#${seasonNumber}"`
- PairwiseResult.a/b 字段语义扩展（不动结构）；已有 rankings.json 数据继续可用
- 对比卡片 / 排名列表加「S0X」徽标
- 解决：大明王朝（46 集单季）跟绝命毒师（7+13+13+13+16 五季）放一起比不合理的问题

### 工程化

- **EpisodeNotes 用 BTreeMap 而非 HashMap**：序列化 key 字典序稳定，git diff 友好
- **store 加 `upsertBook` 工具函数**：6 个新 action 共享一份 list 更新逻辑
- **selector 加 4 个新 hook**：`useSeasonsForBook` / `useEpisodesForBook` / `useEpisodeFor` / `useEpisodeStats`
- **kind 切换时表单兜底**：tv/anime 自动给单季 0 集；其他清空 season state
- **老数据零迁移**：`serde(default)` 让所有老字段反序列化成 `None` / 空值；前端的「单季剧兜底」逻辑对老书也能正常展示

### 数据兼容性

- 老 book 文件无 `seasons` / `episodes` → undefined → UI 跳过该区块，零迁移
- 老 `progress.current` / `progress.total` 语义不变，仍是"线性最高已看"
- 单集 `watched` 允许乱序（跳看 / 重看），与 `progress.current` 解耦
- 老 rankings.json 数据继续可用（rank ID 解析兼容旧字符串）

### 标签

- `book-tracker-v1.2`

两 tag 同 commit hash，按 release workflow 分派构建。

---

## v1.3（2026-08）：集笔记时间戳（stamps）

**单集时间戳笔记**。在 v1.2 「单集笔记」基础上加 stamp 区块，让用户看剧时手动标"开始时间 [→ 结束时间] 描述"的片段笔记（例：`00:32:15 - 00:35:40` 高潮追车），按时间顺序自动排列。

### 数据模型

- **`TimeStamp`**：`{ id: UUID, start: 秒, end?: 秒, note: 文本 }`
  - 时间统一存**秒**（避免 mm:ss/hh:mm:ss 在 UI 切换 / 持久化跨平台时反复解析）
  - `id` 用 `crypto.randomUUID()`，让 edit/delete 能精确锁定单条
  - `end` 可选 —— 单时间点（"这一刻"）vs 时间段（"这段场景"）
- **`EpisodeRecord.stamps?: TimeStamp[]`**：每集独立的 stamp 列表
  - 写盘策略：数组为空 → 不写字段；老文件缺字段 → `undefined`（向后兼容，`parse_episodes` 容错）
  - 自动按 `start` 升序排序（同 start 按 id 字典序）；前端 `sortStamps` + 后端 `parse_stamps` 双重兜底
  - 单条 stamp 的 `end` / `note` 允许空串/null（语义 = "这一刻无笔记" / "这一刻为单时间点"）

### UI（`EpisodesPanel.tsx` 展开区底部）

- **stamp 列表**：按 `start` 升序自动排列，每行显示 `[hh:]mm:ss → [hh:]mm:ss` + 可编辑笔记 + 删除按钮
- **stamp 添加行**：`开始 [→ 结束(可选)] + 笔记 + +`；Enter 提交；输入校验（解析失败 / 结束 < 开始 提示）
- **整体替换式回写**：单条 add/edit/delete 都构造新数组 + `sortStamps` 再整体回写 service，避免单条 IPC 的并发冲突
- **删除整集记录**：watched/note/title/stamps 四步清零（service 兜底最稀疏删 key）

### Rust 后端

- `types.rs` 加 `TimeStamp` + `EpisodeRecord.stamps`
- `data/books.rs::parse_stamps` 容错（缺 id / start / note → 跳过该条，不阻塞整本读）
- `data/books.rs::persist` 写盘：`stamps` 非空才写，单条 stamp 始终写 `id/start/note`，`end` 仅在 `Some` 时写
- `service/books.rs::set_episode_stamps`：整体替换 stamps + 服务端按 start 排序兜底
- `service/books.rs::set_episode_*` 三个原有方法补 `stamps: None`（or_insert_with 完整字段）+ 删 key 判断加 `has_stamps` 维度
- `commands.rs::books_episode_set_stamps` + `lib.rs::invoke_handler` 注册

### IPC

- `books_episode_set_stamps(id, season, episode, stamps)` —— stamps 为空数组等同"清空该集所有 stamp"

### 工具函数（`apps/book-tracker/src/shared/types.ts`）

- `formatStamp(seconds)` —— 秒 → `mm:ss`（< 1h）/ `hh:mm:ss`（≥ 1h）
- `parseStamp(input)` —— `ss` / `mm:ss` / `hh:mm:ss` → 秒；非法输入返回 `null`
- `sortStamps(stamps)` —— 按 start 升序稳定排序（同 start 按 id 字典序）

### 工程化

- **Book 领域专属测试目录**（v1.3 起）：`apps/book-tracker/src/shared/__tests__/` 加 `stamp.test.ts`（13 测试）；`vitest.config.ts::include` 同时扫 tracker-core + 本目录，跑 `npm test` 一起跑
- **领域 vs 共享内核**：stamp 工具函数绑定 Book 领域（`EpisodeRecord.stamps` 是 Book 字段），不进 `packages/tracker-core`
- **整体替换 vs 单条 IPC**：选择整体替换而非 4 个单条 command（addStamp / updateStamp / deleteStamp / clearStamps），理由：
  1. stamp 输入短，提交即写盘，单条 IPC 的延迟开销不划算
  2. 整体回写天然 idempotent；断网 / 重复点击无副作用
  3. 服务端再排序兜底，前端排序 bug 也不会污染持久化

### 数据兼容性

- 老 book 文件无 `stamps` 字段 → undefined → UI 跳过该区块，零迁移
- stamp 单条字段缺损（缺 id / start / note）→ 容错跳过该条，整本仍可读
- 与 v1.2 一致：服务端读回时排序，保证持久化后的顺序稳定

### 测试

- `episode_stamps_round_trip_and_omit_when_empty`（data/books.rs::tests）—— 6 个不变量的回归测试
- `stamp.test.ts`（apps/book-tracker）—— 13 个纯函数测试（formatStamp / parseStamp / sortStamps 各覆盖）
- book-tracker cargo test 33 / vitest 156（v1.2 是 31 / 143），新增 2 cargo + 13 vitest
- monorepo 全量：cargo test 152 / vitest 563 全绿

### 标签

- `book-tracker-v1.3`

两 tag 同 commit hash，按 release workflow 分派构建。
---

## v1.4 (2026-09): RANK 跳过语义 — 会话内每本只展示一次

**「跳过」不再弹老对**。v1.3 之前 pickNextPair 是纯函数（counts + ratings），跳过不写 history 不会触发算法重选 —— 用户点「跳过这对」后屏幕上要么是同一对（A = 对比次数最少,跳过不改变 count,A 锁定 / B 评分最接近 A 没变），要么是只换了一个（A 的 count 平局被打乱时），要么是两本互换位置（新 B 评分恰好在原 A 范围）。

### 核心层（[共享]）

- packages/tracker-core/src/ranking.ts::pickNextPair 新增可选参数 exclude: ReadonlySet<string>（放在 rng 之后，默认空 Set，旧调用全兼容）：
  - 先按 exclude 缩窄候选；若缩窄后候选 < 2 → 返回 null
  - A / B 都在缩窄后的候选里挑 → 跳过永远不会再弹老对
  - minCount 仍在 pool 全集里算（被排除项也参与「最少比较」基数），避免小池子里被排除项反而被优先选出
- packages/tracker-core/src/__tests__/ranking.test.ts 新增 5 个 exclude 用例：排除 A 候选 / 排除 B 候选 / 缩窄后 < 2 返回 null / 空 Set 与 5-arg 签名等价 / 池子顺序与 exclude 顺序无关

### Renderer 层

- apps/book-tracker/src/renderer/store/ranking.ts：
  - store 加 recentlyShown: string[] 会话状态（选完 a/b/tie 或跳过都会被记入）
  - pickPair / applyResult 内部 helper pickAndRememberPool 用 exclude = Set(recentlyShown) 调 pickNextPair,再把新一对加入
  - load() / setKind() 重置 recentlyShown —— 重新打开 Modal 或切 kind 视为新会话
  - resetSession() 同时清 recentlyShown 与 sessionCount
- apps/book-tracker/src/renderer/components/RankingCompare.tsx：
  - 新增「未展示 / 已展示」计数展示在 meta 行
  - 「跳过」按钮在 freshCount < 2 时 disabled，hover title 提示重置方法
  - currentPair === null && freshCount < 2 时显示「本轮对比的候选已经全部展示过」空状态（引导用户点工具栏 × 或关闭重开）
  - 关键 bug 修复：React Rules of Hooks —— 把新加的 useMemo（deriveRanking / shownSet / freshCount）全部上移到所有 early return 之前；否则「未选 kind → 选了 kind」时 hook 计数对不上，整组件报红（与 book-tracker AGENTS.md §十.28 同款）

### 数据兼容性

- rankings.json 字段零变化：PairwiseResult / RankingFile 都不动
- 已有任意 rankings.json 数据继续可用：exclude 是 UI 会话状态，不持久化
- 关闭 Modal / 切 kind / 点 × 都会重置 exclude，跨会话不会污染

### 测试

- tracker-core vitest 23/23（原 18 + exclude 新 5）
- book-tracker vitest 161/161（含跨仓库共享）
- typecheck + cargo 不需重跑（Rust 不动）

### 标签

- （待发 tag 时）

---

## v1.5 (2026-09): 作品双链 `[[角色名]]` —— Obsidian 风格 wiki-link

**笔记里点名词跳到角色笔记**。在所有自由文本字段里支持 `[[角色名]]` 双链语法,自动链接到角色笔记(local 命中 / 全局唯一 / 全局多匹配 picker / 断链一键创建)。**后端零改动 —— `[[小明]]` 原样存进 frontmatter 字符串,只在渲染层识别**(跟 Obsidian 同款)。

### 新增能力

- **共享内核(纯函数 + 测试)**
  - `apps/book-tracker/src/shared/wikilink.ts` 新增三个纯函数:
    - `parseWikilinks(text)` —— 提取所有 `[[...]]` 内的目标名(去重保留顺序;空 / 纯空白跳过)
    - `splitWikilinkSegments(text)` —— 把文本切成 `plain | wikilink` 段,渲染层用
    - `resolveWikilink(target, ctx)` —— 在「当前作品 + 全作品」上下文中解析:
      - **local** 当前作品里找到该 character(精确匹配、大小写敏感、trim 后比对)
      - **global-unique** 跨作品唯一命中
      - **global-multi** 跨作品多条同名 → 候选列表
      - **broken** 哪里都没找到
  - `collectLocalCharacterCandidates(book)` / `collectAllCharacterCandidates(books)` —— 候选构造
  - 测试:`apps/book-tracker/src/shared/__tests__/wikilink.test.ts` —— **40 个用例**(parseWikilinks 12 / splitWikilinkSegments 8 / resolveWikilink 12 / candidates 8)
  - **不进 tracker-core**:wikilink 绑定 `Character` 概念,life-tracker 没角色;留 book-tracker 内(同 stamp.test.ts 思路)

- **4 处文本字段支持 wikilink**(Book.notes / Character.notes / EpisodeRecord.note / TimeStamp.note)
  - **textarea `[[` 触发 picker**:输入 `[[` 后弹全局 picker(候选 = 当前 book 全量 character);↑↓ 选 / Enter 确认 / Esc 关闭;支持搜索过滤 + 「+ 创建新角色」入口
  - **picker 关闭时自动插入 `[[name]]`** 到光标位置,光标落到 `]]` 之后
  - **直接打 `[[新名字]]`** 不开 picker,文本原样存进 frontmatter,渲染时自动标「断链」
  - **复用 hook**:`useWikilinkTextarea(book, value, setValue)` 把「`[[` 检测 + 插入 + 光标定位」统一封装,4 处 textarea 共用,父组件只负责自己的 debounce 写盘逻辑

- **WikilinkText 渲染组件**:
  - 把 textarea 下方文本切成 plain + wikilink 段,wilink 段渲染成可点击 button
  - 视觉(由 status 决定 className):
    - **local** —— 主题色 + hover 下划线;点击 → 滚到 CharactersPanel 并展开该 character
    - **global-unique** —— 同上 + 角标 `↗`;点击 → 切到目标 book + 展开该 character
    - **global-multi** —— `角色名 · N处 ↗`;点击 → 弹跨作品 picker,选完跳转
    - **broken** —— 红色虚线下划线 + `[[]]` 包裹显示;点击 → 弹「创建角色『xxx』」modal
  - React.memo 包装 + useMemo 缓存整张 segments 解析

- **WikilinkContext 全局协调层**:
  - 4 类交互(navigateLocal / navigateGlobal / openGlobalPicker / openCreate)统一暴露给 WikilinkText
  - picker / create 模态全局唯一(同时只能开一个);Provider 挂在 `App.tsx` 顶层
  - 跨作品跳转走 `store.navigateToCharacter` 字段(新增)→ CharactersPanel 监听后自动展开
  - **store 新增字段**:`navigateToCharacter: { bookId, characterId } | null` + `setNavigateToCharacter` action

### 实现关键决策

- **数据格式不变**:`[[小明]]` 原样存进 frontmatter 字符串(同 Obsidian / Logseq)。**后端 / IPC / Rust / 数据层全部零改动**;既不引入 links.json,也不做字符转换 —— 渲染时实时解析。
- **大小写敏感 + 精确匹配**:避免英文作品里大小写误匹配;模糊匹配留后续。
- **`[[` 重复触发防护**:检测 `value.slice(cursorPos - 2, cursorPos) === '[['` 时,排除前一个字符也是 `[` 的情况(`[[[` 不会重复触发 picker)。
- **用户中间输入处理**:picker 打开后用户在 textarea 继续敲的内容会被截到 `]]` 后(已知行为,记入 dev-notes)。用户敲了闭合 `]]` 也会自动删掉(避免 `[[name]]]]`)。
- **跨作品跳转 store 字段**:CharactersPanel 用本地 `useState(expandedId)` 管展开,但跨组件跳转需要全局信号;新增 `navigateToCharacter` 字段,CharactersPanel useEffect 监听并消费后清回 null。

### 视觉与样式

- `.wikilink-preview-block` —— textarea 下方预览容器(muted + dashed 顶边 + 紧凑内边距)
- `.wikilink-resolved` / `.wikilink-global` / `.wikilink-multi` —— 主题色 + hover 下划线
- `.wikilink-broken` —— 红色虚线下划线 + mono 字体 + `[[]]` 包裹视觉提示
- `.wikilink-picker-modal` —— picker 模态样式(参考 NextSeasonPicker 紧凑搜索 + 列表模式)
- `.wikilink-create-modal` —— 创建模态样式

### 数据兼容性

- **完全零迁移**:老 book 文件没有 wikilink 概念,但 `[[...]]` 之前就是普通字符串 —— 现在多了渲染语义,无需任何转换
- 后端 IPC schema 零变化(`Character` / `EpisodeRecord` / `TimeStamp` 字段不动;只是前端多了一个 view 层)
- 老作品导入 / 跨机器同步:无影响
- 跨作品 link 引用被删 book:变 broken(无需清理,因为不在 frontmatter 字段里)

### 工程化

- **测试**:book-tracker vitest 201/201(原 161 + wikilink 40)
- typecheck 三端全过
- cargo test book-tracker 40 unit + 5 integration 全过(**零改动**确认)

### 共享范围

- 纯函数 + 测试:`apps/book-tracker/src/shared/`(绑定 Character,留 app)
- 渲染 / 协调 / 4 处 textarea 集成:全留 `apps/book-tracker/src/renderer/components/`(领域 UI)
- 后端 / tracker-core / tracker-ui:**全部零改动**

### 标签

- （待发 tag 时）

---

## v1.8 (2026-09): 统一「+ 添加」入口 —— 系列 tab 收口到加作品按钮

**把 TopBar「系」按钮搬进「+ 添加」modal**。v1.7 加 series 概念时,在 TopBar 紧挨「+ 加作品」按钮右侧多塞了一个「系」按钮 + `s` 快捷键 —— 用户体验反馈:"想要统一在加作品按钮里,但条目内容不一样"。本次重构把加作品 / 加系列 / 管理系列收口到**单一 modal + tabs**,TopBar 回到「+」一个按钮,UI 更克制,意图也更清晰。

### 新增能力

- **`AddModal`(统一添加 modal,v1.8 新增)** —— TopBar「+ 添加」按钮(快捷键 `n`)→ 单一 Modal,tabs 在 [+ 作品] / [+ 系列] 之间切换
  - **tab 切换 + 内容差异化**:同款 tab 组件 + 不同 body(BookFormFields / SeriesView),用户能感知「都是『+ 添加』但加的内容不一样」
  - **footer 按 tab 动态化**:`<button form="book-form">` 触发 BookFormFields 内部 form 提交;「系列」tab 不需要 footer(自身有 CRUD 按钮 + 右上 × 关闭)
  - **共享 Modal 原则**:AddModal 是唯一 Modal,所有 tab 内容都是纯 body —— 避免 Modal 内嵌 Modal 的不可控行为(backdrop 双重叠加、Esc 关闭竞态)
- **`BookFormFields`**(原 `BookForm` form body 抽出) —— 加作品表单的 `<form>` 内容,不再自带 Modal 包装
- **`SeriesView`**(原 `SeriesModal` body 抽出) —— 系列列表 + CRUD 的 `<div>` 内容,不再自带 Modal 包装
- **TopBar 收口**:`+ 加作品` 按钮名 → `+ 添加`(语义更宽,涵盖两个 tab);移除 `onSeries` prop 和「系」按钮;移除 `s` 快捷键
- **BookDetail overflow 提示更新**:同系列 9 本以上时提示文案从「TopBar『系』按钮展开所有系列」改为「在『+ 添加』→『系列』tab 查看全部系列」

### 重构路径

- **Modal-in-Modal 反模式 → 拆「*Fields / *View」**:原 BookForm / SeriesModal 都自带 `<Modal>` 包装;要让它们塞进 AddModal 必须先**剥掉 Modal 包装**,只留纯 body。BookForm 不再被任何 caller 直接用,直接删除(原本只被 App.tsx 在「+ 加作品」路径调用,总是 `book=null`)。
- **BookForm 编辑模式移除路径**:v1.6 起 BookDetail 走内联编辑,BookForm 只剩「加作品」单一用途。v1.8 拆 BookFormFields 时**彻底删除 `book: Book | null` 参数**(无 caller 引用,无意义保留)。后续若需要「编辑作品弹窗」由新组件承载,不复用 BookFormFields。

### 共享边界

- 整条栈留 app:`AddModal` / `BookFormFields` / `SeriesView` 都是纯 UI 抽象,无领域字段;通过 zustand store 调用领域 IPC(`useBooksStore.create` / `useSeriesStore.create` / `load`)
- 后端 / IPC / Rust / tracker-core / tracker-ui:**全部零改动**(纯 renderer 端 UI 重构)
- 数据格式 / 持久化 / 系列实体:**全部不动**(只是 entry point 改了)

### 用户体验变化

| 旧路径 (v1.7) | 新路径 (v1.8) |
|---|---|
| TopBar 「+ 加作品」按钮 → 加作品表单 | TopBar 「+ 添加」按钮 → AddModal「+ 作品」tab |
| TopBar 「系」按钮 / 快捷键 `s` → SeriesModal | 「+ 添加」modal → 「+ 系列」tab |
| BookDetail 「设置系列」按钮 → SeriesPickerModal | 不变(BookDetail「设置系列」仍可用) |

### 工程化

- **typecheck 三端全过**:book-tracker / life-tracker / tracker-core 都跑过 `npm run typecheck`
- **book-tracker vitest 201/201 通过**(无新增/删除测试 —— 纯 UI 重构)
- **book-tracker cargo test 67/67 通过**(纯 renderer 端改动,Rust 不动)
- **book-tracker vite build 466 KB / 70 KB CSS**(跟 v1.7 持平)
- **Tab 复用 `.mode-toggle` class**:复用了 TopBar 日常模式 / 编辑模式 tab 切换的样式,无新 CSS(只有 `.add-modal-tabs` 14px 间距)

### 数据兼容性

- **完全零迁移**:book / series / relations / rankings 文件结构无变化;series.json 持久化路径不变
- **TopBar 入口变化是纯 UX**,用户已建好的 series 完全保留,只需从「+ 添加」→「+ 系列」tab 进入管理
- **快捷键变化**:移除 `s` 快捷键(原 SeriesModal 开关);保留 `n`(开 AddModal);`g` / `r` / `e` / `c` / `Esc` 不变

### 标签

- （待发 tag 时）

---

## v2.0 (2026-09): 系列侧栏入口 —— 系列徽章插入 status 分组(inline-row 模式)

**侧栏系列入口**。用户在编辑模式左侧栏直接看到系列,以「系列徽章」插入到各 status 分组顶部 —— 不必再走 AddModal「+ 系列」tab 就能进入系列视图。

### 核心能力

- **系列徽章插入到 status 分组顶部**(inline-row 模式,当前唯一选项,留扩展位):
  - 每个 status 分组顶部展示「该 status 下至少有一本属于该 series」的徽章
  - 徽章文本:`[集] 系列名 (N 本)`(`N` = 该 series 全量成员数,跨 status 聚合)
  - 视觉:chip 风格,accent 边框 + 浅底色,跟 book row 区分
  - 选中态(切到 series 视图时):背景变 accent + 白字
- **跨 status 重复**:同系列在多个 status 分组都出现(成员跨 status 时)
- **搜索去重**:有搜索时,徽章只在该 series「first status」(按 STATUS_ORDER 第一个含它的 status)展示一次,其余 status 跳过
- **worksFilter 影响**:`worksFilter !== 'all'` 时,系列只在「至少一本成员符合 kind」时展示
- **collapsed 不影响**:某 book `collapsed = true` 时仍属原 status,该 series 徽章依然在原 status 展示
- **点徽章 → 整左侧栏切到 series 视图**(`SidebarSeriesView`):
  - 顶部:← 返回 + 系列名 + (N 本) + id
  - 成员列表:kind-tag + title + author + tracker-id + × 移除按钮(无 confirm,跟 BookDetail × 同款)
  - 空成员时:提示「进「+ 添加」→「+ 系列」tab 管理」
  - 「+ 添加作品」按钮:disabled 占位(留 AddModal 入口完整)
- **点 ← 返回 / 点成员 / 系列被删 → 回 status 分组视图**(selectedSeriesId / removingMemberId 三处统一清零)
- **新配置项**:`Config.sidebar_series_entry_mode`(TS + Rust 镜像)—— 当前固定 `inline-row`,预留扩展位

### 新组件

- **`SeriesRowInSidebar.tsx`** —— 系列徽章 row,接收 `(series, memberCount, expanded, onClick)`,渲染 chip 风格按钮
- **`SidebarSeriesView.tsx`** —— 整左侧栏 series 视图,跟 SeriesDetailBody 同款但只读 + × 移除(无「+ 添加」/「删除系列」)

### Config 链路

- **TS**:`Config.sidebar_series_entry_mode?: SidebarSeriesEntryMode` + `SidebarSeriesEntryMode = 'inline-row'` + settings store 字段 `sidebarSeriesEntryMode` + `setSidebarSeriesEntryMode` action
- **Rust**:`Config.sidebar_series_entry_mode: String` + `default_config()` 设 `"inline-row"` + `normalize()` 白名单 fallback + `ConfigPatch.sidebar_series_entry_mode: Option<String>` + `set_config` 路径同样白名单过滤
- **单测**:`invalid_sidebar_series_entry_mode_falls_back_to_inline_row` + `missing_sidebar_series_entry_mode_uses_default`(两条 Rust 测试覆盖「缺损 + 垃圾值」)

### 共享边界

- 整条栈留 book-tracker app;tracker-core / tracker-ui / crates/tracker-core 零改动
- 无新 IPC(复用现有 `books_set_series`)
- Rust 端只加 `Config` 字段 + `normalize` 兜底 + `ConfigPatch` 字段 + 单测

### 工程化

- **typecheck 三端全过**:book-tracker / life-tracker / tracker-core
- **book-tracker vitest 205/205 通过**(无新增/删除 —— 纯 UI 改造)
- **book-tracker cargo test 67 + 2 = 69/69 通过**(新增 2 个 Config 字段容错测试)
- **series 视图切换走 BookList 局部 useState**(selectedSeriesId / removingMemberId),不污染全局 zustand store
- **不动 BookPatch / 不动 series store**:纯渲染层新增 + Config 字段扩展

### 数据兼容性

- **完全零迁移**:老 config.json 缺 `sidebar_series_entry_mode` 字段 → Rust 端 `#[serde(default)]` + normalize 兜底 fallback `inline-row`(同 theme / format)
- **共享边界遵守**:整条栈留 app,不动 tracker-core(系列是 book-tracker 领域专属)
- **worksFilter / search / collapsed 行为均向后兼容**:老用户的 series 仍可见,徽章位置由派生计算决定(自动适配)
- **快捷键不变**:无新增快捷键;点徽章 = 鼠标点击 / 键盘 Enter

### 标签

- （待发 tag 时）
