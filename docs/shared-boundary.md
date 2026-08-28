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
| packages/tracker-core: unlock.ts / validate.ts / progress.ts / types.ts（Edge/Progress/UnlockResult/BrokenEntry/PrereqSpec/ExcludeSpec） | TS |
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

## 待办（UI 基座共享）

初版迁移时，**UI 组件未抽进共享包**：`Modal / TopBar / GraphView / GraphModal / PrereqEditor` 目前在两个 app 各复制一份（领域耦合点：状态颜色 / store 访问 / 候选搜索字段）。逻辑内核已全部共享，这部分待两个 app 有 UI 级改动、或需要保持视觉一致时再做：

- 抽 `packages/tracker-ui`：Modal（零耦合，可直接进）；TopBar（title/placeholder/callbacks 参数化）；GraphView（改纯展示：接 nodes/links 数据 + 颜色映射 props）；PrereqEditor（items/edges/setAll props 化）；styles-base.css（CSS 变量基座）
- 改完 book-tracker 与 life-tracker 都指向 `@ui/*`，重跑两 app typecheck / build 验证

## 变更记录

- v3.1（relations 不变量校验）：新增 `validate` 模块（Rust + TS 1:1），检查「同一个 `to` 只能有一条前置边」——该不变量被 `compute_unlocked` 的 `to → Edge` 索引隐式依赖，破坏时静默丢弃前置条件。**当前只告警不拒绝**（写入路径与读取路径都打警告，不阻断），收紧成硬拒绝只需把 app 层 `set_relations` 的告警改成 validate 闭包的 `Some(msg)`。
- v3（countable 多次引用）：`GroupSpec.members` 从 `string[]` 升级为 `(string | {id, count?})[]`，支持 per-member count（如 `(B 完成 2 次) OR C 完成`）；旧 `["a","b"]` 形态完全兼容，serde 自定义 visitor 双向兼容。`SimpleSpec` 同 id 可多次添加（不同 count 视为独立实例），`removeRow` 改为按 `(id, count)` 精确匹配。
- v2（前置规格化）：`Edge` 扩展 `specs: PrereqSpec[]` 与 `excludes: ExcludeSpec[]`，支持『简单 / 二选一组 / 计数 / 互斥』四种前置规格。旧 `rule+threshold+groups` 路径完全兼容（无新字段 → 旧行为）。
- v1（monorepo 初建）：从 book-tracker 抽取 core，life-tracker 从 core 长出；UI 基座共享列为待办
