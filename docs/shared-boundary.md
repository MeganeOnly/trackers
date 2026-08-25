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
| crates/tracker-core: config.rs（config.json 读写骨架） | Rust |
| crates/tracker-core: data_dir.rs（双仓 + cache + init_with_picker，app 名参数化） | Rust |
| packages/tracker-core: unlock.ts / progress.ts / types.ts（Edge/Progress/UnlockResult/BrokenEntry） | TS |
| packages/tracker-ui: Modal / TopBar / GraphView / GraphModal / PrereqEditor / styles-base.css | TS/React |

### B. 参数化共享（进 core，抽象薄）

| 逻辑 | 参数化方式 |
|---|---|
| unlock | `computeUnlocked(items, edges, isDone: (id) => boolean)`；Rust 用 `done: &HashMap<String,bool>` |
| progress 文案 | parse/normalize/bump/percent 进 core；`formatProgress` 的"章"等文案留 app |
| data_dir | `DataDir::new("book-tracker" \| "life-tracker")`，cache 用 `Mutex<HashMap<String,String>>` |

### C. 领域专属（各 app 持有，禁止进 core）

- 领域类型字段：Book（title/author/country/year/translator/read_count）vs Goal（名称/描述/类别/deadline/里程碑/量化指标）
- 状态机名称与语义、文案（含进度单位）
- 表单 / 卡片 / 列表 / 详情页 / 页面布局
- renderer api shim（命令名 books_* / goals_* 不同）
- 领域 CSS

## 变更记录

- v1（monorepo 初建）：从 book-tracker 抽取 core，life-tracker 从 core 长出
