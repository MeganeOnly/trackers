# AGENTS.md — book-tracker 项目 onboarding

> **给后续 agent 看的开发指南**。本文件应随项目一起 commit；不含本机路径 / 私人化信息。

> **monorepo + workspaces 迁移后说明（重要）**：本应用已并入 `trackers` monorepo（仓库根 `<repo-root>`），并启用了 npm workspaces。
> 共享逻辑已抽到 monorepo 内核，**不要在本目录重新实现/复制**：
> - 解锁图 + 环检测：`tracker-core`（TS `packages/tracker-core/src/unlock.ts`、Rust `crates/tracker-core/src/unlock.rs`）
> - 进度纯函数：`packages/tracker-core/src/progress.ts` / `crates/tracker-core/src/progress.rs`
> - 原子写 / JSON / 数字 ID / frontmatter / config / data_dir：`crates/tracker-core`
> - 本目录 `src/shared/` 只保留 Book 领域类型与文案（`formatProgress`）；`src/shared/unlock.ts` / `progress.ts` 纯函数已删除
> - **改共享逻辑去 monorepo 根**，改完一个 commit 两 app 同生效（见根 `AGENTS.md` §五 + `docs/shared-boundary.md`）

> **workspaces 安装（必读）**：
> - 公共 devDependencies（`typescript` / `vite` / `vitest` / `@tauri-apps/cli` / `@vitejs/plugin-react` / `@types/*` / `gray-matter`）**已在根 `package.json`**；本目录 `package.json` 只剩运行时 `dependencies`。
> - **只在仓库根跑一次 `npm install`**——所有依赖 hoisted 到 `<repo-root>/node_modules/`。**不要在本目录跑 `npm install`**，会绕过 hoist。
> - 跑 `npm run dev` / `npm test` / `npm run typecheck` 时 npm 自动把根 `node_modules/.bin/` 加到 PATH，`vite` / `tsc` / `vitest` / `tauri` 都找得到，不需要改 PATH。
> - 完整命令速查见根 `AGENTS.md §六`。

## 一、定位

**book-tracker** 是一个本地书籍追踪器（Tauri 2 桌面应用），管理：

- **想读的书** + **前置依赖**（多对多网状结构，自动算"现在能读哪本"）
- **状态**：`want` / `shelved` / `reading` / `finished` / `abandoned`
- **章节进度**：记录连载小说的"第 N / 总 M 章"
- **关系图**：力导向可视化

**不是**一个云同步、社交、推荐类应用。**纯本地**，用户数据和应用代码**完全分离**（代码仓 vs 数据仓是两个独立 repo）。

## 二、技术栈与决策

| 维度 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Tauri 2 | 单二进制 + 小体积 + Rust 后端文件 I/O 稳定 |
| Rust 后端 | stable GNU toolchain + tauri-plugin-{dialog,opener} | 文件 I/O / data_dir picker / 资源管理器跳转 |
| 构建 | Vite 5（仅 renderer）+ Cargo（src-tauri/） | renderer 单段构建，Rust 独立编译 |
| UI | React 18 + TS | 主流，无构建魔法 |
| 状态 | zustand 5 | 无 Provider / 无 Redux 模板代码 |
| 文件存储 | 每本书一个 `.md` + `relations.json` | 用户数据可直接 `git init` 进 GitHub |
| frontmatter | 手写 JSON（自实现 `split_frontmatter`） | 避免 alpha `matter` crate；Rust 端写 JSON，解析端优先 JSON 失败 fallback 空对象 |
| ID 生成 | 纯递增数字（`make_base_id` 取 max+1） | 简洁、文件名短、天然唯一 |
| 关系图 | react-force-graph-2d | 力导向，500 节点流畅 |
| 测试 | vitest 4（shared/）+ cargo test（src-tauri/） | renderer 纯函数 vitest；Rust 单元测试 cargo test |

**未引入**的状态管理 / 路由 / UI 库——刻意保持小。如果将来要加，按"是不是真的需要"判断，不要为了"现代化"而引入。

## 三、目录结构

```
src/                              # renderer + shared
├── main.tsx                       # React 入口
├── App.tsx                        # 顶层组件 + 全局快捷键 + 首启 picker 流程
├── styles.css                    # 全部样式（单文件，CSS Variables 主题）
├── index.html
├── env.d.ts                       # vite/client 类型引用
├── components/                   # 通用组件
│   ├── TopBar.tsx
│   ├── BookList.tsx              # 编辑模式左侧栏（按状态分组）
│   ├── BookDetail.tsx            # 编辑模式右侧详情
│   ├── BookForm.tsx              # 加书/编辑 modal
│   ├── PrereqEditor.tsx          # 前置依赖编辑器
│   ├── GraphView.tsx             # react-force-graph 包装
│   ├── GraphModal.tsx            # 关系图 modal
│   ├── RankingModal.tsx          # 作品排名 modal（Elo 两两对比）
│   ├── RankingList.tsx           # 排名列表视图
│   ├── RankingCompare.tsx        # 两两对比视图
│   ├── RankingKindSelect.tsx     # 类型筛选 tab
│   └── Modal.tsx                 # 通用 modal（footer 槽位）
├── pages/
│   ├── EditMode.tsx              # 编辑模式壳（BookList + BookDetail）
│   └── CleanMode.tsx             # 日常模式（"现在能读哪本"）
├── store/                        # zustand store（每个领域一个文件）
│   ├── books.ts
│   ├── relations.ts
│   ├── mode.ts                   # clean / edit
│   ├── search.ts                 # 全局搜索 query
│   ├── ranking.ts                # 排名 store（kind / pair / sessionCount）
│   └── selectors.ts              # useUnlocked / useGroupedByStatus / useEdgeFor
└── lib/
    └── api.ts                    # Tauri invoke shim（桥接 src-tauri 的 #[tauri::command]）

src-tauri/                        # Rust 后端
├── Cargo.toml                    # tauri 2 + serde + tauri-plugin-{dialog,opener} + tempfile
├── .cargo/config.toml            # linker → ucrt64 gcc
├── tauri.conf.json               # window + bundle(NSIS only)
├── capabilities/default.json     # Tauri 2 capability 权限声明
├── icons/                        # 占位 PNG + 合规 ICO
└── src/
    ├── main.rs                   # 二进制入口
    ├── lib.rs                    # 模块声明 + #[cfg(not(test))] tauri_app::run() + invoke_handler
    ├── types.rs                  # Book / Edge / Progress / Config / BookPatch / RankingFile / PairwiseResult serde 镜像
    ├── progress.rs               # 章节进度纯函数 + 单元测试
    ├── unlock.rs                 # compute_unlocked + 环检测 + 单元测试
    ├── data/                     # 文件 I/O 层
    │   ├── books.rs              # 每本书一个 .md(JSON frontmatter + 手写 split_frontmatter)
    │   ├── relations.rs          # relations.json
    │   ├── config.rs             # config.json
    │   ├── ranking.rs            # rankings.json（两两对比历史）
    │   ├── files.rs              # atomic_write / ensure_dir / read_json
    │   └── slug.rs               # make_base_id(纯数字 ID)
    ├── service/                  # 业务逻辑层(调用 data/,对 commands 暴露)
    │   ├── books.rs
    │   ├── relations.rs
    │   ├── config.rs             # ConfigPatch(不允许改 data_dir)
    │   ├── ranking.rs            # ranking 业务封装（get / append，服务端覆盖 ts）
    │   └── data_dir.rs           # 双仓分离 + Mutex<Option<String>> 全局 cache
    └── commands.rs               # 12 + 2 = 14 个 #[tauri::command] + 1 个 app_ensure_data_dir

src/shared/                       # Book 领域类型 + 文案(被 renderer 用,Rust 端有 serde 镜像)
├── types.ts                      # Book / BookStatus / Config + re-export core 的 Edge/Progress/RankingFile/PairwiseResult
├── api.ts                        # ElectronAPI 接口定义(被 renderer 用)
└── progress.ts                   # formatProgress(领域文案;纯函数在 tracker-core)
```

> **共享内核在 monorepo 根**：`packages/tracker-core`（TS 纯函数 + 测试）+ `crates/tracker-core`（Rust）。
> 本目录 `src-tauri/src/` 不再有 `unlock.rs` / `progress.rs` / `data/files.rs` / `data/slug.rs` / `data/relations.rs`——
> 全部在 `crates/tracker-core`；`src/shared/` 不再有 `unlock.ts` / `progress.ts` 纯函数与 `__tests__/`。

**依赖方向**（单向，禁止反向）：

```
shared/types.ts  ←  renderer/*  (通过 lib/api.ts invoke)
     ↑
     └── src-tauri/src/types.rs  (Rust serde 镜像)
                ↑
                └── src-tauri/src/commands.rs  (#[tauri::command])
```

`shared/` 不依赖任何 Tauri API，是纯函数 + 类型，可以在测试里直接 import。Rust 端 `types.rs` 是 TS 类型的 serde 镜像，二者通过 IPC JSON 通信时字段名 / 值完全一致。

## 四、数据模型与文件格式

### `Book`（一本书一个 `.md`）

```markdown
---
{
  "id": 1,
  "title": "百年孤独",
  "author": "加西亚·马尔克斯",
  "country": "哥伦比亚",
  "year": 1967,
  "translator": "范晔",
  "status": "reading",
  "read_count": 2,
  "progress": { "current": 12, "total": 100 },
  "created": "2024-01-15T...",
  "updated": "2024-03-20T...",
  "tags": ["小说", "拉美文学"],
  "notes": "马尔克斯的魔幻现实主义开山之作..."
}
---

# 百年孤独
```

**frontmatter 序列化约束**：

- **Rust 端手写 JSON**（`split_frontmatter` 函数，~30 行，优先 JSON 解析，失败 fallback 空对象）
- `progress` 字段写为 `"progress": { "current": 12, "total": 100 }`（单行 JSON）或省略（无进度时）
- 字段缺损 / 类型错误时**容错为 `null`**，不抛错——否则会破坏旧书文件
- 不要把 `progress: null` 写进 frontmatter（`write_book` 已经做了"有值才写"的判断）
- `collapsed`（编辑模式侧栏收起）同上款「仅 `true` 时写盘、缺省 `false`」；**所有 status 都允许**，从 EditMode 侧栏的 status 分组移到侧栏底部『已收起』分组，纯展示层、不影响 status / 解锁 / CleanMode 任何行为
- `notes`（用户笔记）同上款「空串不写盘」——避免污染 frontmatter;body 段不再保留 `## 笔记` 占位,旧 body 文本在首次编辑时丢失（v1 取舍,迁移逻辑后续可加）
- `starring`（主演,仅 movie/tv 字段）同上款「空串不写盘」——避免污染 frontmatter;老文件缺字段 → ""（向后兼容）
- `screenwriter`（编剧,仅 movie/tv 字段）同上款「空串不写盘」——与 starring 共享同一策略;老文件缺字段 → ""（向后兼容）
- `tags` 是数组,空数组 `[]` 总是写盘（保留语义 = "用户清空了所有 tag"）

### `relations.json`（前置关系图）

```json
{
  "version": 1,
  "edges": [
    { "to": "3", "prerequisites": ["1", "2"], "rule": "all" },
    { "to": "4", "prerequisites": ["1", "2", "3"], "rule": "any_of", "threshold": 2 }
  ]
}
```

### `config.json`

```json
{
  "version": 1,
  "data_dir": "<用户选定的数据目录路径>",
  "language": "zh-CN",
  "default_mode": "clean"
}
```

## 五、状态机

| 状态 | 含义 | 算"已掌握"吗 |
|---|---|---|
| `want` | 想看 | — |
| `shelved` | 搁置 | — |
| `reading` | 在读（第 N 次） | **否** |
| `watching` | 在看（第 N 次）| **否** |
| `finished` | 已读 | **是** |
| `abandoned` | 弃读 | 否 |

只有 `finished` 才算"已掌握"，才会让前置它的书解锁。

`reading` / `watching` 都属于「进行中」色族,语义一致 —— `watching` 仅在表单层对
非电影类型暴露（解决"已看完后再追一遍时 `reading` 措辞尴尬"），Rust 端接受任意类型的
`watching` 序列化（保留扩展空间）。解锁图仍只看 `finished`，两种「进行中」状态对
`isDone` 谓词完全正交。

## 六、解锁规则（`computeUnlocked` / `compute_unlocked`）

- `all`：所有前置 `finished` 才解锁
- `any_of`：至少 `threshold` 个前置 `finished` 才解锁
- 无前置：永远解锁
- **循环依赖**：被检测到的环上的书**全部置为不解锁**，不参与解锁计算
- 性能：带 memo 的迭代 DFS，单测已覆盖
- TS 端在 `packages/tracker-core/src/unlock.ts`，Rust 端在 `crates/tracker-core/src/unlock.rs`（monorepo 共享），二者逻辑等价（TS 用于 renderer 实时计算，Rust 用于校验）

## 七、架构两层（Rust commands / renderer）

**加新功能的标准流程**：

1. 在 `src/shared/types.ts` 加类型（如 `Progress`） → 同步在 `src-tauri/src/types.rs` 加 serde 镜像
2. 在 `src/shared/api.ts` 加 API 接口（如 `BookAPI.progressBump`）
3. 在 `src-tauri/src/data/*.rs` 加 / 改文件 I/O（持久化逻辑）
4. 在 `src-tauri/src/service/*.rs` 加业务方法（包装 data 层）
5. 在 `src-tauri/src/commands.rs` 加 `#[tauri::command]` 并在 `lib.rs` 的 `invoke_handler` 注册
6. 在 `src/renderer/lib/api.ts` 加 invoke 调用（`api.books.progressBump(id, delta)`）
7. 在 `src/renderer/store/*.ts` 加 zustand store action
8. 在 `src/renderer/components/*.tsx` 接 UI
9. 在 `src/shared/__tests__/*.test.ts` 或 `src-tauri/src/*` 内联测试加单测（如果加了纯函数）
10. **更新 `README.md` + 本文件的"已实现功能"清单**

**反向 import 是 bug**：renderer 永远不能 import `src-tauri/`，Rust 端也不能 import renderer。它们只能通过 `src/shared/types.ts`（类型契约）+ Tauri `invoke()` 通信。

## 八、开发约定

- **TypeScript 严格模式**：所有 `.ts` / `.tsx` 走 `tsc --noEmit`；`npm run typecheck` 同时跑 node（仅 `vite.config.ts`）+ web 两段
- **Rust 严格模式**：`cargo build` + `cargo test` 都需通过；`#[tauri::command]` / `tauri::Builder` 等大依赖用 `#[cfg(not(test))]` 隔离，避免 `cargo test` 拉 webview2
- **EOL**：`.gitattributes` 强制 `* text=auto eol=lf`——所有提交文件 LF
- **状态管理**：一个领域一个 store 文件，不要把多个领域塞进同一个 zustand store
- **Tauri command 名**：`snake_case`（Rust 函数名 = Tauri 命令名）；`invoke('books_list')`，参数 `{ id, patch, edges }` 等对象形式
- **错误传播**：Rust 端 `Result<T, String>`，Tauri 2 自动把 Err 序列化为 JS 异常；renderer 用 try/catch；不要在 service 层 swallow
- **不引入未使用依赖**：装包前确认不会被 tree-shake 掉；`gray-matter` 仅测试用，已在 devDependencies
- **commit 粒度**：一个独立逻辑单元一个 commit；如果非要合并多个改动，message body 必须说明合并理由
- **commit message 风格**：Conventional Commits（`feat(scope): ...` / `fix(scope): ...` / `refactor: ...` / `docs: ...`），scope 用领域名（`books` / `ui` / `clean` / `edit` / `graph` / `tauri` / `build`）

## 九、常用命令

```bash
# 装包（workspaces，repo 根跑一次）
cd <repo-root> && npm install            # 所有依赖 hoisted 到 <repo-root>/node_modules/

# 开发
npm run dev              # tauri dev(启动 Vite + 编译 Rust + 打开原生窗口，带热重载，Vite 1420)
npm run dev:vite         # 只跑 Vite dev server(1420)，不编译 Rust(纯 renderer 调试用)

# 构建
npm run build            # tauri build(产物: src-tauri/target/release/bundle/nsis/*.exe)
npm run build:vite       # 只跑 vite build(产物: dist/，供 tauri build 消费)

# 校验
npm run typecheck        # tsc 双段(node: vite.config.ts；web: renderer + shared + @core)
npm test                 # vitest run（tracker-core 共享纯函数，见 vitest.config.ts）

# 仓库根命令（不 cd 进 app）
cd <repo-root>
npm run dev:book         # 等价于上面的 npm run dev
npm run dev:life         # 等价于 apps/life-tracker 的 npm run dev
npm run typecheck        # 三端 + core 全 typecheck
npm run test             # core + book + life vitest 全跑

# Rust 后端（workspace 统一在 repo 根跑）
cd <repo-root> && cargo test            # workspace 全量（tracker-core + book-tracker + life-tracker）
cd <repo-root> && cargo build -p book-tracker   # 单独构建本 app
```

Tauri 构建产物在 `src-tauri/target/release/bundle/`（NSIS installer）和 `src-tauri/target/release/book-tracker.exe`（可执行文件）。Vite 构建产物在 `dist/`。

## 十、踩过的坑（避免重复踩）

1. **`BookInput` 是 `Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags'>`**——加新必填字段到 `Book` 后必须同步加到 `BookInput` 类型，或在表单构造 input 时显式 `progress: null` 之类的占位
2. **`progress: null` 不能省略**——TypeScript 的 `Omit<Book, ...>` 会保留新字段，缺了会报 `Property 'progress' is missing`
3. **frontmatter 写为 JSON**：不要尝试 `matter::serde_yaml` 风格，Rust 端直接 `serde_json::to_string` 写单行 JSON 对象；解析时按 `---` 切分后 trim 内容，尝试 `serde_json::from_str`，失败 fallback 空对象（避免旧 YAML 文件直接崩）
4. **写盘判断**：`write_book` 只在 `book.progress` 真值时写 progress 字段——不要无条件 spread Book 整个对象，否则 `progress: null` 会污染 frontmatter
5. **状态切走时清 progress**：编辑表单里如果 status 从 `reading` 切到其他，要主动设 `patch.progress = null`，否则旧的 progress 会留着误导用户
6. **快速按钮走专用 command**：`+1 / -1 / +5` 不要走完整的 `books_update` patch 合并，专用 `books_progress_bump` command，避免读 100 本同时点 +1 时每次都序列化整个 Book 对象
7. **`BookPatch.progress` 三态**：Rust 端用 `Option<Option<Progress>>` 配合自定义 `double_option` deserializer——`None`（字段缺）= 不改 / `Some(None)`（null）= 清空 / `Some(Some(p))` = 设值。serde 默认会把 `null` 吞成 `None`，必须自定义反序列化器区分两种 `None`
8. **cycle detection 不能漏**：`compute_unlocked` 必须先用 DFS 找出所有环，环上节点**全部置为不解锁**；漏了会让死循环里的书永远解锁（逻辑 bug）
9. **ID 唯一性**：`write_book` 调 `make_base_id` 取现有最大数字 ID +1 写入；忽略非数字 ID（防止老 pinyin 残留混入）。**不要**改回带后缀的 collision 方案（`-2`/`-3`）——数字 ID 之间天然唯一，无需额外处理
10. **renderer 不能 import `node:fs`**——vite 会编译失败；如果要在 renderer 用工具函数，提炼到 `src/shared/` 并确保不引 Node API
11. **`useEffect` 依赖数组**：如果用了 `useBooksStore((s) => s.x)` 这种 selector，要么确保 selector 返回稳定引用，要么用 `useShallow` 包一下——否则无限循环
12. **首次 picker 后必须初始化 data_dir**：选完目录后**同步**调 `data_dir::init_with_picker` —— Rust 端该函数自动写应用层 config.json + 数据层 config.json + `books/` 目录，避免空壳目录
13. **`ConfigPatch` 不允许改 data_dir**：data_dir 切换走专门的 `data_pick_dir` 命令，`config_set` 的 patch 字段只允许 `language` / `default_mode`
14. **Tauri `crate-type = ["rlib"]`**：去掉 cdylib，避开 Windows GNU toolchain 的 export ordinal 限制；`cargo test` 时拉不到 webview2，`#[cfg(not(test))]` 隔离 `commands.rs` / `service/` / `tauri_app`
15. **新增 BookStatus 时同步所有 STATUS_LABELS / STATUS_COLORS / STATUS_ORDER 字典**：`types.ts` 的 `BookStatus` 加 `watching` 后,renderer 各组件的 `Record<BookStatus, string>` 字典必须加对应 entry(否则 TS typecheck 报 `Property 'watching' is missing`);`useGroupedByStatus` / `CleanMode` 的 `Record<BookStatus, Book[]>` 同理 —— 加字段后全仓库 grep `BookStatus` / `Book['status']` 一次保险
16. **空串字段的写盘策略**：可选字符串字段（如 `notes`）写盘前判断 `is_empty()` 不写 frontmatter,避免污染;`tags` 这种数组类型相反 —— 空数组 `[]` 写盘（保留"用户清空了所有 tag"的语义）。两种语义不能混;新加可选字段前先想清楚
17. **Canvas 绘制状态污染**：react-force-graph 的 `nodeCanvasObject` 在 d3-force 模拟里频繁调用,所有 `ctx.fillStyle` / `strokeStyle` 改完必须还原（或在函数开头重置）,否则下一个节点用错颜色。`drawTagChips` 用 chip 间 fillStyle 重置 + 局部变量规避了这个问题
18. **类型感知的字段标签**：同一份表单套 5 种作品类型时,作者 / 年份 / 国家的语义不同（书→出版年份,影视→首播/上映年份,书→原产国,影视→制片国家）。实现方式：纯函数 `authorLabelFor(kind)` / `yearLabelFor(kind)` / `countryLabelFor(kind)` 集中维护 label 文案 —— 比 inline 三元 / switch 散在各处好维护
19. **v1.2 集笔记稀疏策略 + 季变保留旧 key**：单集 `episodes` map key = `"${season}-${episode}"`,watched=true / 有 note / 有 title 才占 key(最稀疏);季数中途变化(原 3 季改 4 季)保留旧 key 不清理,避免"用户有 S03E05 笔记但新季结构只剩 3 季时被静默删"。决策点：决策 B = 保留旧 key;后续若需"自动清理"再加 confirm 提示
20. **EpisodeNotes 用 BTreeMap 而非 HashMap**：Rust 端用 BTreeMap 让序列化时 key 字典序稳定,git diff / frontmatter 跨平台 diff 友好;TS 端 `Record<string, EpisodeRecord>` 实际遍历顺序由 JS 引擎决定,无此问题但保持镜像一致
21. **rankId 扩展语义**：v1 RANK 的 PairwiseResult.a/b 是 book.id(字符串),v1.2 扩展为 `book.id` 或 `"${book.id}#${seasonNumber}"` —— Rust 端只改 `string` 语义,不动 PairwiseResult 结构;已有的 rankings.json 数据继续可用(老 rankId = book.id 不会变),UI 端按 `#` 存在与否区分候选
22. **`books_episode_bump` vs `books_progress_bump` 区分**：前者 progress + 联动 watched,后者只动 progress。`-1` 走 episode_bump 但不动 episodes(允许用户保留笔记);如果复用 progress_bump 再单独调 setEpisodeWatched 会需要两次 IPC,且若用户连续点 `-1 +1` 会出现 race。最终:单一原子 command 解决
23. **`Omit<Book, ...>` 加新字段时记得同步 3 个地方**:`Book` 加 `seasons` / `episodes` 后,(1) `BookInput` 要 `Omit` 掉 `episodes`(单集不进表单);(2) `BookPatch` 加对应 Option 字段;(3) 写盘逻辑判定稀疏策略(空数组 / 空 map 不写盘)。漏一处 typecheck / 行为必错

## 十一、已实现功能清单

- [x] 加作品：作品名 / 作品类型（书、动画、电视剧、电影、其他）/ 作者·主创 / 国家 / 年份 / 译者
  - **类型感知字段标签**：按 `WorkKind` 自动切换"作者/原作/主创/导演"、"出版/开始/首播/上映年份"、"原产国/制片国家"；"译者"仅书显示，"主演"仅 movie/tv 显示 —— 两者位置对称,UI 不会同时出现
- [x] 编辑作品（Modal 复用加作品表单）
- [x] 删除作品（confirm 提示）
- [x] 状态切换（5 种）+ 快速按钮（在详情页）
- [x] **「在看」状态（`watching`，仅非电影类型可选）** —— 与 `reading` 语义一致,色族同属「进行中」;解决"已看完后再追一遍时 `reading`(在读)措辞尴尬"的问题
- [x] 第 N 次看（`read_count`，仅 `reading` / `watching` 时）
- [x] **进度**（`progress: { current, total }`，仅 `reading` / `watching` 时，详情页有 `-1 / +1 / +5 / 看完` 快速按钮）
- [x] 前置依赖编辑器（多对多）
- [x] 解锁规则：`all` / `any_of` + threshold / **二选一组合 `groups`**（AND-of-ORs）
- [x] 循环依赖检测
- [x] 日常模式：自动列"现在能看的作品"，按反向度数排序
- [x] 日常模式：搁置/已读/弃读折叠区
- [x] 编辑模式：按状态分组的侧边栏
- [x] **编辑模式：跨 status 的『已收起』分组（`Book.collapsed`，纯展示）**——所有 status 都允许，与 status / 解锁 / CleanMode 完全正交
- [x] 设置面板：新建作品默认类型 + 展示筛选（全部/按类型，按钮式高亮）
- [x] 全局搜索（作品名 / 作者 / ID / tag 模糊匹配）
- [x] 全局快捷键：`n` 加作品 / `g` 关系图 / `r` 排名 / `e`/`c` 切模式 / `Esc` 清搜索
- [x] **标签**（`Book.tags: string[]`，后端 + UI 全链路打通）：表单逗号分隔输入；GraphView 节点下方画 chip；空串不写盘
- [x] **笔记**（`Book.notes: string`）—— `<textarea>` 直编辑,不渲染 Markdown(v1 取舍);空串不写盘
- [x] **主演**（`Book.starring: string`,仅 movie/tv 暴露）—— 与"译者"位置对称;空串不写盘
- [x] **编剧**（`Book.screenwriter: string`,仅 movie/tv 暴露）—— 与"主演"同属影视主创字段,但各自独立 input 行(避免"主演/编剧"标签二义);空串不写盘,与 starring 共享同一策略
- [x] **季信息**（`Book.seasons: SeasonInfo[]`,仅 tv/anime）—— 在加作品表单的「季设置」区块定义,总集数自动 = seasons 求和;空数组不写盘
- [x] **单集稀疏 map**（`Book.episodes: Record<"${season}-${episode}", EpisodeRecord>`,仅 tv/anime）—— 详情页「集笔记」面板按季分组展示;支持乱序看 / 单集笔记 / 单集标题 / watched toggle;空 map 不写盘
  - 决策 4(稀疏): 单集清空笔记 → 删 key;最稀疏形态 `{ "1-3": { "watched": true } }`
  - 决策 B(季变): 季数中途变化保留旧 episodes key,不自动清理超出范围
  - 决策 v1.3:EpisodeRecord 加 `stamps?: TimeStamp[]` 字段 —— 单集时间戳笔记,见下方
- [x] **单集时间戳笔记**（`EpisodeRecord.stamps: TimeStamp[]`,v1.3 新增,仅 tv/anime）—— 详情页「集笔记」展开区底部加 stamp 区块
  - `TimeStamp = { id: UUID, start: 秒, end?: 秒, note: 文本 }` —— 手动输入开始/结束时间 + 笔记,标记"这一刻"或"这段场景"
  - 时间格式支持 `ss` / `mm:ss` / `hh:mm:ss` 三种人类格式,存储统一用秒(避免跨平台格式不一致)
  - 自动按 `start` 升序排序(同 start 按 id 字典序);服务端读回时再排序一次兜底
  - 写盘策略:stamp 数组为空 → 不写字段;单条 stamp 的 `end`/`note` 允许空串/null
  - 设计选择:**整体替换式回写**(不再做单条 IPC),add/edit/delete 都构造新数组 + sortStamps;简单 / 可恢复 / 避免并发冲突
- [x] **进度 +1/-1 联动集笔记**（`books_episode_bump` command）—— `+1` 时线性遍历 seasons,把接下来 N 个未看集标 watched;`-1` 不动 episodes(允许用户保留笔记 / 标记状态)
- [x] **季选择器**(「上一季 / 下一季」+ tab) —— 用户要求放在集笔记区上方,默认选中第一个未完全看完的季
- [x] **RANK 按季拆分**（v1.2 排名细化）—— tv/anime 按季独立排名,rankId = `${bookId}#${seasonNumber}`;其他 kind 保持原 rankId;对比卡片 / 排名列表都加「S0X」徽标
  - 解决:大明王朝(46 集单季) 跟 绝命毒师(7+13+13+13+16 五季) 放一起比不合理
- [x] 关系图（react-force-graph-2d，500 节点流畅，节点下方画 tag chip）
- [x] **作品排名**（两两对比 Elo 评分）：TopBar「排」按钮 / 快捷键 `r` → Modal
  - kind 切换（书/动画/电视剧/电影/其他）+ 各 kind 已读数量徽标
  - 排名列表 tab：按 Elo 评分倒序，条形图可视化，标题 / 作者 / 对比次数 / 评分
  - 对比 tab：左右两本候选（标题 + 作者 + 年份 + 国家 + tags），点击选 winner，支持「跳过」「平局」
  - 池 = `status === 'finished'` 且 `kind === 选中 kind` 的书
  - 评分算法 + pair 选择策略进 `packages/tracker-core/src/ranking.ts`（领域无关，未来 goal-tracker 可直接复用）
- [x] 用户数据目录 picker（首次启动）
- [x] 数据目录结构初始化（picker 完成后同步写 `config.json` + `books/`，避免空壳）
- [x] 配置文件 `config.json` 持久化（含 `default_work_kind` / `works_filter`）
- [x] vitest 单测（unlock + progress，renderer/shared）
- [x] Rust 单元测试（progress + unlock + books + config）
- [x] Tauri 端到端接通（renderer invoke → Rust command → 文件 I/O）

## 十二、未实现 / 后续可加

- [ ] 数据导入/导出（JSON / CSV）
- [ ] 备份 / 还原
- [ ] 多用户数据目录切换 UI（已支持切换，但需重启应用）
- [ ] 国际化（目前硬编码中文）
- [ ] GitHub Actions release workflow（构建 + 发 Release）
- [ ] `docs/architecture.md`（README 里有占位，待补）
- [ ] 笔记 Markdown 渲染（v1 用 textarea 直编辑;后续可加 renderer）
- [ ] 标签自动联想 / 历史建议（目前是逗号分隔裸输入）

## 十三、测试规范

- **共享 TS 纯函数测试**放 monorepo `packages/tracker-core/src/__tests__/*.test.ts`（tracker-core 测试）
- **Book 领域专属 TS 纯函数测试**放 `apps/book-tracker/src/shared/__tests__/*.test.ts`（v1.3 起;`episodeKey` / `parseEpisodeKey` / stamp 工具函数等 —— 这些函数绑定 Book 领域语义,tracker-core 不应包含)
  - `vitest.config.ts` 的 `include` 同时扫 `packages/tracker-core/src/__tests__` + `src/shared/__tests__`,跑 `npm test` 时一起跑
- **Rust 纯函数测试**放 `crates/tracker-core`（共享部分）或本目录 `src-tauri/src/*` 内联 `#[cfg(test)] mod tests`
- 跑：TS `npm test`（本目录,扫两边）;Rust 在 repo 根 `cargo test`

## 十四、数据目录约定

应用启动时 `App.tsx` 调用 `api.app.ensureDataDir`：

- 已有 `data_dir`（应用层 `%APPDATA%/book-tracker/config.json` 写过 + 目录存在）→ 直接返回
- 不存在 → `App.tsx` catch 后调 `api.data.pickDir()`，Rust 端 `data_pick_dir` 命令弹原生文件夹 picker，选完后**同步**初始化：
  - 应用层 `%APPDATA%/book-tracker/config.json` 写 `data_dir`
  - 数据层 `<data_dir>/config.json` 写完整 `Config`（默认 `language='zh-CN'`、`default_mode='clean'`）
  - 数据层 `<data_dir>/books/` 目录创建（避免空壳）
- 用户取消 picker → 应用保持未初始化状态，console 警告，UI 不加载数据（留给后续 P-iteration 加 banner 提示重试）

**两层 config 的区别**：

- `%APPDATA%/book-tracker/config.json`（应用层）→ 只存 `data_dir` 一个字段，是应用启动入口
- `<data_dir>/config.json`（数据层）→ 完整 `Config`（`data_dir` / `language` / `default_mode`），用于设置面板读写和"切换数据目录"逻辑

**用户数据目录结构**：

```
<data_dir>/
├── books/<id>.md          # 每本书一个文件，id 为纯数字
├── relations.json        # 前置关系图（懒创建）
├── rankings.json         # 排名历史：两两对比记录（懒创建）
└── config.json           # 用户配置（含 data_dir 自身）
```

**与代码仓分离**：用户数据含个人阅读历史，建议在数据目录单独 `git init` 并推到**另一个** GitHub 仓库，**不要**跟代码混在一起。
