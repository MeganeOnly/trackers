# 共享边界（shared boundary）

> 两个 tracker 应用（book-tracker / life-tracker）之间的共享边界约定。
> **改代码前先看本文件**：新功能归属 core 还是 app，按下面的规则判断。

## 核心规则

**只有"两个 app 都需要、且语义完全一致"的代码才进 core（`packages/tracker-core` / `crates/tracker-core` / `packages/tracker-ui`）。跟领域绑定、或将来会异化的东西一律留 app。**

判断检查表（新增代码逐条过）：
1. 两个 app 都会用吗？只一个用 → 留 app
2. 语义在两边完全一致吗？如"解锁=所有前置完成"→ 一致；如"解锁=前六名绩点"这种量化 → 不一致，参数化或留 app
3. 会因领域而分化吗（文案 / 状态名 / 字段）？会 → 留 app 或做参数
4. 改了需要两边同步吗？需要且同构 → 进 core（这正是 core 存在的意义）

## 三类清单

### A. 全共享（直接进 core，零/少改造）

| 文件 | 归属 |
|---|---|
| crates/tracker-core: files.rs（ensure_dir / atomic_write / read_json / write_json） | Rust |
| crates/tracker-core: slug.rs（make_base_id 数字 ID） | Rust |
| crates/tracker-core: frontmatter.rs（split_frontmatter / normalize / now_iso） | Rust |
| crates/tracker-core: unlock.rs（compute_unlocked / detect_cycles） | Rust |
| crates/tracker-core: validate.rs（validate_edges / format_issues，relations 不变量校验） | Rust |
| crates/tracker-core: config.rs（config.json 读写骨架） | Rust |
| crates/tracker-core: data_dir.rs（双仓 + cache + init_with_picker，app 名参数化） | Rust |
| crates/tracker-core: ranking（PairwiseResult / RankingFile / PairwiseWinner；两两对比 Elo 算法） | Rust |
| packages/tracker-core: unlock.ts / validate.ts / progress.ts / ranking.ts（Edge/Progress/UnlockResult/BrokenEntry/PrereqSpec/ExcludeSpec/PairwiseResult/RankingFile + Elo 纯函数） | TS |
| packages/tracker-ui: Modal / TopBar / GraphView / GraphModal / PrereqEditor / styles-base.css | TS/React |

### B. 参数化共享（进 core，抽象薄）

| 逻辑 | 参数化方式 |
|---|---|
| unlock | `computeUnlocked(items, edges, isDone: (id) => boolean)`；Rust 用 `done: &HashMap<String,bool>` |
| progress 文案 | parse/normalize/bump/percent 进 core；`formatProgress` 的"章"等文案留 app |
| data_dir | `DataDir::new("book-tracker" \| "life-tracker")`，cache 用 `Mutex<HashMap<String,String>>` |

### C. 领域专属（各 app 持有，禁止进 core）

- 领域类型字段：Book（title/author/country/year/translator/read_count）vs Goal（名称/描述/类别/deadline/量化进度）
- 状态机名称与语义、文案（含进度单位）
- 表单 / 卡片 / 列表 / 详情页 / 页面布局
- renderer api shim（命令名 books_* / goals_* 不同）
- 领域 CSS
- **领域专属实体**(v1.7 book-tracker 的 `Series`):类型 + 路径 + 读写 + IPC + 业务方法全在 `apps/book-tracker`;`tracker-core` 不持有;life-tracker 不需要

## UI 基座已落地（v1.1 起）

`packages/tracker-ui` 已完整落地（v1.1 起逐步抽取），两 app 通过 `@ui/*` alias 共享：

- **React 组件**：`Modal`（v1.1）/ `GraphView`（v1 后续）/ `TopBar` / `GraphModal` / `PrereqEditor`（各 app 仍持有，因含领域 store 接入；共享层只导出纯展示件）
- **CSS 基座**：`base.css`（全局 reset + token + typography）+ `themes/{classic,library,codex}.css` + `GraphView.css`
- **hooks / DOM 中介**：`useTheme.ts`（`applyTheme` / `applyFormat` / `applyFontSource` / `applyCozyTokens` + `normalizeTheme` / `normalizeFormat` / `normalizeBool` + `applyInitialTheme` / `applyInitialFormat` / `applyInitialFontSource` / `applyInitialCozyTokens`）
- **字体文件**：`src/fonts/*.ttf`（v2.1 加 Fraunces 本地副本，~460KB / 6 个 ttf）

新增视觉/交互能力时**默认进共享层**（两 app 同时受益）；领域专属样式（状态色 / 卡片结构）留 app。

## 变更记录

- v2.1（视觉微调开关）：「字体加载（CDN/本地）」+「视觉舒适（标准/柔和）」两个独立可逆开关，默认关闭，行为与现状一字不动。**共享层**：`packages/tracker-ui/base.css` 加 `@font-face 'Fraunces Local'` + `:root[data-font-source]` + `:root[data-cozy-tokens]` 选择器；`useTheme.ts` 加 `applyFontSource` / `applyCozyTokens` / `normalizeBool` / `applyInitialFontSource` / `applyInitialCozyTokens`；字体文件 `packages/tracker-ui/src/fonts/`。**book-tracker 专属**：`Config.use_local_fonts` / `Config.use_cozy_tokens`（TS + Rust 1:1）+ `ConfigPatch` + normalize + 单测（缺字段 / 垃圾值 / 兜底）+ `settings store` 加 `useLocalFonts` / `useCozyTokens` + `SettingsPanel` 加开关 UI。**life-tracker 不暴露开关**：共享 CSS 始终听 renderer 的 data-attr，life 端永远不设 → 默认 off → 原版一致；token 切换**就绪但未激活**，将来 life-tracker 加 SettingsPanel 时镜像开关即可。判定依据：「视觉改进可逆性」属于两 app 都用得到的基座能力（CSS / 字体 / token），但「可逆开关的 UI 入口」只对有 SettingsPanel 的 book-tracker 有意义（life 暂未做 SettingsPanel，留待后续）。
- v1.7（book-tracker 「系列」概念）：新增 `Series` 领域实体（v1.7 新增）—— 顶层独立 `series.json` + `Book.seriesId` 单向引用 + 6 个 IPC（`series_list / series_get / series_create / series_update / series_delete / books_set_series`）。**仅进 book-tracker**，不进 tracker-core：series 是 book-tracker 领域专属（life-tracker 没有"几季 + 衍生作品"的归组诉求）。跟 v1.6 `nextSeasonId` 的关系：`nextSeasonId` 是"线性季链"（有方向），`seriesId` 是"无序归组"（收藏夹语义），两者独立可共存。共享判定：领域专属实体一律留 app（含类型 + 路径 + 读写 + 业务方法 + IPC + UI），共享层 (`tracker-core`) 不持有任何领域专属概念。
- v3.1（relations 不变量校验）：新增 `validate` 模块（Rust + TS 1:1），检查「同一个 `to` 只能有一条前置边」——该不变量被 `compute_unlocked` 的 `to → Edge` 索引隐式依赖，破坏时静默丢弃前置条件。**当前只告警不拒绝**（写入路径与读取路径都打警告，不阻断），收紧成硬拒绝只需把 app 层 `set_relations` 的告警改成 validate 闭包的 `Some(msg)`。
- v3（countable 多次引用）：`GroupSpec.members` 从 `string[]` 升级为 `(string | {id, count?})[]`，支持 per-member count（如 `(B 完成 2 次) OR C 完成`）；旧 `["a","b"]` 形态完全兼容，serde 自定义 visitor 双向兼容。`SimpleSpec` 同 id 可多次添加（不同 count 视为独立实例），`removeRow` 改为按 `(id, count)` 精确匹配。
- v2（前置规格化）：`Edge` 扩展 `specs: PrereqSpec[]` 与 `excludes: ExcludeSpec[]`，支持『简单 / 二选一组 / 计数 / 互斥』四种前置规格。旧 `rule+threshold+groups` 路径完全兼容（无新字段 → 旧行为）。
- v1（monorepo 初建）：从 book-tracker 抽取 core，life-tracker 从 core 长出；UI 基座共享列为待办
