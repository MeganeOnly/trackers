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