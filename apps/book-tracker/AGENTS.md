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
│   ├── BookFormFields.tsx        # **v1.8 新增** —— 加作品表单 body（无 Modal 包装，给 AddModal 用）
│   ├── AddModal.tsx              # **v1.8 新增** —— 统一「+ 添加」modal，tabs 切换 作品 / 系列
│   ├── SeriesView.tsx            # **v1.8 新增** —— 系列管理视图 body（无 Modal 包装，给 AddModal「系列」tab 用）
│   ├── PrereqEditor.tsx          # 前置依赖编辑器
│   ├── GraphView.tsx             # react-force-graph 包装
│   ├── GraphModal.tsx            # 关系图 modal
│   ├── RankingModal.tsx          # 作品排名 modal（Elo 两两对比）
│   ├── RankingList.tsx           # 排名列表视图
│   ├── RankingCompare.tsx        # 两两对比视图
│   ├── RankingKindSelect.tsx     # 类型筛选 tab
│   ├── SeriesPickerModal.tsx     # **v1.7 新增** —— BookDetail 用,紧凑搜索 + 新建入口
│   ├── SeriesDetailBody.tsx      # **v1.9 新增** —— 系列详情 body(无 Modal 包装,给 SeriesView 的 'detail' view 用)
│   ├── SeriesPickBooksBody.tsx   # **v1.9 新增** —— 批量加入系列 picker body(无 Modal 包装,给 SeriesView 的 'picker' view 用)
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
    ├── types.rs                  # Book / Edge / Progress / Config / BookPatch / RankingFile / PairwiseResult / Series / SeriesFile / SeriesInput / SeriesPatch serde 镜像(v1.7 加 Series 全家)
    ├── progress.rs               # 章节进度纯函数 + 单元测试
    ├── unlock.rs                 # compute_unlocked + 环检测 + 单元测试
    ├── data/                     # 文件 I/O 层
    │   ├── books.rs              # 每本书一个 .md(JSON frontmatter + 手写 split_frontmatter;v1.7 加 series_id 字段)
    │   ├── relations.rs          # relations.json
    │   ├── config.rs             # config.json + paths(books_dir / relations_file / **series_file**)
    │   ├── ranking.rs            # rankings.json(两两对比历史)
    │   ├── series.rs             # **v1.7 新增** —— series.json 读写(单文件存所有 series)
    │   ├── files.rs              # atomic_write / ensure_dir / read_json
    │   └── slug.rs               # make_base_id(纯数字 ID)
    ├── service/                  # 业务逻辑层(调用 data/,对 commands 暴露)
    │   ├── books.rs              # **v1.7 加** set_series()(走专用 IPC,不走 BookPatch)
    │   ├── relations.rs
    │   ├── config.rs             # ConfigPatch(不允许改 data_dir)
    │   ├── ranking.rs            # ranking 业务封装( get / append,服务端覆盖 ts)
    │   ├── series.rs             # **v1.7 新增** —— series 业务逻辑(CRUD + delete 联动清理 book.seriesId 引用)
    │   └── data_dir.rs           # 双仓分离 + Mutex<Option<String>> 全局 cache
    └── commands.rs               # 14 + 6 = 20 个 #[tauri::command] + 1 个 app_ensure_data_dir(v1.7 加 series_list/get/create/update/delete + books_set_series)

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

1. **v1.9 SeriesView 三态 view 状态机替代 Modal 嵌套**(2026-09 加 series drill-down 时踩):SeriesView 已经在 AddModal 内(AddModal 是 v1.8 唯一 Modal),新增「往系列里加/减成员」入口时,如果按直觉把 SeriesDetailModal / SeriesPickBooksModal 写成自含 Modal,会变成「AddModal 里嵌 Modal」—— backdrop 双重叠加、Esc 关闭竞态、点 backdrop 关两次(v1.8 §十.35 已踩)。**正确做法**:**用 view 状态机**(`'list' | 'detail' | 'picker'`)+ 把每个 view 抽成「无 Modal 包装的 body 组件」(SeriesDetailBody / SeriesPickBooksBody),全部由 SeriesView 在 `return` 处按 view 分派,**AddModal 始终是唯一 Modal**。判据:任何「我想在 Modal 内弹新 Modal」的冲动,先看能不能用 view state + body 组件表达 —— 通常可以。
2. **v1.9 行可点击 + 子按钮 stopPropagation 模式**:list 行做成 `onClick={openDetail}` 的可点击 li 后,行内的「编辑」/「删除」按钮如果不阻断冒泡,点按钮会先触发行 onClick(进 detail)再触发按钮 onClick(编辑/删除),用户困惑。**正确做法**:按钮的 `onClick` 里 `e.stopPropagation()`,**外层 li 不需要任何额外判断**;另外行处于 inline edit 模式时(`isEditing`),整个 li 设 `cursor: default` + `onClick={undefined}`(避免点 input 也进 detail)。CSS 上 `:hover { background; border-color: var(--accent); }` 给视觉反馈,`:focus-visible` 给键盘用户焦点环。
3. **v1.9 批量 setSeries 部分失败用 alert 列出失败清单**(2026-09):从 SeriesView 一侧批量加入系列时(单次可能 5~20 本),如果用 `Promise.all`,失败的会一起 reject,成功的 books store 已 upsert 但前端不知道哪本失败哪本成功,用户不知道哪些要重试。**正确做法**:**串行 for-loop + 累积 failures 数组**:
   - 全部成功 → 切回 detail,显示已加入
   - 部分失败 → 也切回 detail(成功的可见),`alert("成功 N 本,失败 M 本:\n\n" + 失败清单)`
   - 全部失败 → 留在 picker,让用户调整 / 取消
   
   理由:批量操作的成功部分不应被回滚(用户希望"已经加的别动,我修一下失败的几本再试"),失败清单精确到 book.id + error message,用户能 1:1 对照 books store 排查。**注意**:`setSeries` 内部已经是 `await api.books.setSeries(id, sid)`,zustand `set` 同步,所以串行不需要 await 别的 store 操作;性能足够(几十本)。
4. **v1.9 view 状态机切走要带清理**:detail / picker view 持有的局部状态(`removingId` / `picked: Set<string>`)在切回 list 时应清零,避免下次进同一 series 看到旧 picking 状态。`backToList()` 里 `setRemovingId(null)` 是关键。`picked` 是 SeriesPickBooksBody 自己的 useState,该组件 unmount 时自然丢,不用手动清;但 `useEffect(() => { setQuery(''); setPicked(new Set()); }, [series.id])` 在 series 切换时强制重置,防止打开 A → 退 → 进 B 时残留 A 的搜索词 / 选中。
5. **v1.9 删除系列时若正好在 detail / picker 视图 → 强制回到 list**:用户在 detail 视图时点了 series 删除(`handleDelete`),Rust 端联动清空所有 book 的 seriesId,但前端 `selectedSeriesId` 还指向已删的 series —— `selectedSeries = seriesList.find(s => s.id === selectedSeriesId) ?? null` 会变成 null,detail body 渲染失败。**正确做法**:`handleDelete` 后判断 `if (selectedSeriesId === id) { setSelectedSeriesId(null); setView('list') }`。这条比 v1.8 的「删除当前 book 选回 list」更隐晦,因为 series 列表跟 series 删除都在 SeriesView 一处。
6. **`BookInput` 是 `Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags'>`**——加新必填字段到 `Book` 后必须同步加到 `BookInput` 类型，或在表单构造 input 时显式 `progress: null` 之类的占位
7. **`progress: null` 不能省略**——TypeScript 的 `Omit<Book, ...>` 会保留新字段，缺了会报 `Property 'progress' is missing`
8. **frontmatter 写为 JSON**：不要尝试 `matter::serde_yaml` 风格，Rust 端直接 `serde_json::to_string` 写单行 JSON 对象；解析时按 `---` 切分后 trim 内容，尝试 `serde_json::from_str`，失败 fallback 空对象（避免旧 YAML 文件直接崩）
9. **写盘判断**：`write_book` 只在 `book.progress` 真值时写 progress 字段——不要无条件 spread Book 整个对象，否则 `progress: null` 会污染 frontmatter
10. **状态切走时清 progress**：编辑表单里如果 status 从 `reading` 切到其他，要主动设 `patch.progress = null`，否则旧的 progress 会留着误导用户
11. **快速按钮走专用 command**：`+1 / -1 / +5` 不要走完整的 `books_update` patch 合并，专用 `books_progress_bump` command，避免读 100 本同时点 +1 时每次都序列化整个 Book 对象
12. **`BookPatch.progress` 三态**：Rust 端用 `Option<Option<Progress>>` 配合自定义 `double_option` deserializer——`None`（字段缺）= 不改 / `Some(None)`（null）= 清空 / `Some(Some(p))` = 设值。serde 默认会把 `null` 吞成 `None`，必须自定义反序列化器区分两种 `None`
13. **cycle detection 不能漏**：`compute_unlocked` 必须先用 DFS 找出所有环，环上节点**全部置为不解锁**；漏了会让死循环里的书永远解锁（逻辑 bug）
14. **ID 唯一性**：`write_book` 调 `make_base_id` 取现有最大数字 ID +1 写入；忽略非数字 ID（防止老 pinyin 残留混入）。**不要**改回带后缀的 collision 方案（`-2`/`-3`）——数字 ID 之间天然唯一，无需额外处理
15. **renderer 不能 import `node:fs`**——vite 会编译失败；如果要在 renderer 用工具函数，提炼到 `src/shared/` 并确保不引 Node API
16. **`useEffect` 依赖数组**：如果用了 `useBooksStore((s) => s.x)` 这种 selector，要么确保 selector 返回稳定引用，要么用 `useShallow` 包一下——否则无限循环
17. **首次 picker 后必须初始化 data_dir**：选完目录后**同步**调 `data_dir::init_with_picker` —— Rust 端该函数自动写应用层 config.json + 数据层 config.json + `books/` 目录，避免空壳目录
18. **`ConfigPatch` 不允许改 data_dir**：data_dir 切换走专门的 `data_pick_dir` 命令，`config_set` 的 patch 字段只允许 `language` / `default_mode`
19. **Tauri `crate-type = ["rlib"]`**：去掉 cdylib，避开 Windows GNU toolchain 的 export ordinal 限制；`cargo test` 时拉不到 webview2，`#[cfg(not(test))]` 隔离 `commands.rs` / `service/` / `tauri_app`
20. **新增 BookStatus 时同步所有 STATUS_LABELS / STATUS_COLORS / STATUS_ORDER 字典**：`types.ts` 的 `BookStatus` 加 `watching` 后,renderer 各组件的 `Record<BookStatus, string>` 字典必须加对应 entry(否则 TS typecheck 报 `Property 'watching' is missing`);`useGroupedByStatus` / `CleanMode` 的 `Record<BookStatus, Book[]>` 同理 —— 加字段后全仓库 grep `BookStatus` / `Book['status']` 一次保险
21. **空串字段的写盘策略**：可选字符串字段（如 `notes`）写盘前判断 `is_empty()` 不写 frontmatter,避免污染;`tags` 这种数组类型相反 —— 空数组 `[]` 写盘（保留"用户清空了所有 tag"的语义）。两种语义不能混;新加可选字段前先想清楚
22. **Canvas 绘制状态污染**：react-force-graph 的 `nodeCanvasObject` 在 d3-force 模拟里频繁调用,所有 `ctx.fillStyle` / `strokeStyle` 改完必须还原（或在函数开头重置）,否则下一个节点用错颜色。`drawTagChips` 用 chip 间 fillStyle 重置 + 局部变量规避了这个问题
23. **类型感知的字段标签**：同一份表单套 5 种作品类型时,作者 / 年份 / 国家的语义不同（书→出版年份,影视→首播/上映年份,书→原产国,影视→制片国家）。实现方式：纯函数 `authorLabelFor(kind)` / `yearLabelFor(kind)` / `countryLabelFor(kind)` 集中维护 label 文案 —— 比 inline 三元 / switch 散在各处好维护
24. **v1.2 集笔记稀疏策略 + 季变保留旧 key**：单集 `episodes` map key = `"${season}-${episode}"`,watched=true / 有 note / 有 title 才占 key(最稀疏);季数中途变化(原 3 季改 4 季)保留旧 key 不清理,避免"用户有 S03E05 笔记但新季结构只剩 3 季时被静默删"。决策点：决策 B = 保留旧 key;后续若需"自动清理"再加 confirm 提示
25. **EpisodeNotes 用 BTreeMap 而非 HashMap**：Rust 端用 BTreeMap 让序列化时 key 字典序稳定,git diff / frontmatter 跨平台 diff 友好;TS 端 `Record<string, EpisodeRecord>` 实际遍历顺序由 JS 引擎决定,无此问题但保持镜像一致
26. **rankId 扩展语义**：v1 RANK 的 PairwiseResult.a/b 是 book.id(字符串),v1.2 扩展为 `book.id` 或 `"${book.id}#${seasonNumber}"` —— Rust 端只改 `string` 语义,不动 PairwiseResult 结构;已有的 rankings.json 数据继续可用(老 rankId = book.id 不会变),UI 端按 `#` 存在与否区分候选
27. **`books_episode_bump` vs `books_progress_bump` 区分**：前者 progress + 联动 watched,后者只动 progress。`-1` 走 episode_bump 但不动 episodes(允许用户保留笔记);如果复用 progress_bump 再单独调 setEpisodeWatched 会需要两次 IPC,且若用户连续点 `-1 +1` 会出现 race。最终:单一原子 command 解决
28. **`Omit<Book, ...>` 加新字段时记得同步 3 个地方**:`Book` 加 `seasons` / `episodes` 后,(1) `BookInput` 要 `Omit` 掉 `episodes`(单集不进表单);(2) `BookPatch` 加对应 Option 字段;(3) 写盘逻辑判定稀疏策略(空数组 / 空 map 不写盘)。漏一处 typecheck / 行为必错
29. **季结构编辑下沉到 EpisodesPanel(v1.4)**:季结构(`seasons`)最初只能在 BookForm 弹窗里改,详情页没法"+1 季"也没法改某季集数——用户只能"编辑作品→打开表单→找到季设置→改→保存",违反就地编辑心智。修复方案:`EpisodesPanel` 顶部加「+ 季」按钮 + 季标题里"X 集"做成 inline `<input type="number">`(失焦/回车写盘)+ 「删除此季」按钮(confirm + 整段 setSeasons)。要点:(a)「X 集」input 用本地 draft 避免每输入一位都触发 IPC;(b)空串/非法值还原不写盘;(c)只改当前季 episodeCount,其他季不动;(d)**不联动改 `book.progress.total`**,理由见下条
30. **季结构变更 ≠ 进度联动**:EpisodesPanel 改季集数时**不**同步 `book.progress.total`,理由:(a) progress.total 是"线性最高已看"参考,季集数变化不影响"已看到第 N 集"的事实;(b) 强行同步会让"+1 季"产生意外的 progress 副作用(用户没主动改进度却看到 total 跳变);(c) 用户后续主动编辑表单时,BookForm 会按 v1.2 的规则把 total = seasons.sum()。**例外**:若新集数 < `progress.current`(用户把 S01 从 24 集改成 12 集但 progress.current=20)——不 clamp,让用户手动处理;已超过新集数范围的旧集笔记按决策 B 保留 key,不再显示
31. **v1.5 lastModified 边界 —— "什么都没改,老时间不变"**:每条笔记(`EpisodeRecord` / `SeasonInfo` / `Character`)顶层挂 `lastModified: number`(毫秒),**仅在笔记内容被改时刷新**。边界三档:
    - **刷**:note 非空字符串写入 / title 非空字符串写入 / stamps 非空数组写入 / name 或 notes 被改
    - **不刷**:`watched` toggle(状态而非笔记内容) / `episode_bump` 联动 / 季号或集数变化(结构变更) / 空字符串"删笔记" / 空数组"删 stamp" / 删除整个 character
    - 实现:后端 service 接受 `last_modified: Option<u64>` 参数,**只有"实际写入内容"分支才刷**;前端 IPC 时**主动判断"是不是真改了"**——空操作不传时间戳。双向保险,避免误刷
    - 老数据缺 `lastModified` 字段 → 读回 `None`(向后兼容);`Some(0)` 等同 `None` 不写盘
32. **v1.5 角色笔记整段 setCharacters IPC(跟 setSeasons / setEpisodeStamps 同款)**:`Book.characters` 数组用 `Vec<Character>`(用户 add 顺序,**不是** BTreeMap —— 跟 EpisodeNotes 的语义区别;`Character` 内部仍带稳定 UUID 用于编辑定位)。UI 在 add / edit / remove character 时**构造新数组整体回写**;**只对"被改的那条"刷 lastModified**,其他角色原值保持。整段 IPC 看起来浪费但实现简单 / 可恢复 / 避免并发冲突(跟 stamp 同款)
33. **React Rules of Hooks:所有 hook 必须无条件、相同顺序、在 early return 之前调用**(2026-09 修 BookDetail 时踩):v1.6 加「下一季」`useMemo` 时直接放到了 `if (!book) return ...` 之后,导致「未选条目 → 选了条目」时 React hook 计数对不上(57 → 58),整组件报红。修复:所有 `useMemo` / `useState` / `useEffect` 上移到 early return 之前,内部用 `book?.xxx` / `if (!book) return []` 兜底。**审查新增 hook 的位置**是改动 React 组件时的强制 checklist —— 任何「先 early return 再 useMemo」都是反模式。共享层教训见 `docs/dev-notes.md` 2026-09 第 1 条
34. **v1.6 「上一季」自动反向同步 + EpisodesPanel tabs 简化**:用户约定"联系不同季的方式是设置'下一季'",所以 EpisodesPanel 顶部的季选择器 tabs(S0X 标签 + ◀ ▶ 按钮 + 「+ 季」)整块删掉 —— 季切换走 BookDetail 的「上一季 / 下一季」区块跳转。加新季走"新建 book + 设下一季"路径。同时**新增** `Book.prevSeasonId` 字段(由 service 层在 `set_next_season` 路径**自动维护**,不暴露 IPC 命令)。双向同步策略:
    - A.nextSeasonId = B → A.next = B, B.prev = A;若 A 之前指向 C → C.prev 清;若 B 之前指向 D → D.next 清;空字符串 normalize 成 None(同 notes / starring)
    - **self-loop 校验**:A.next = A → Err(防止自指)—— 保持原 set_next_season 行为
    - **目标 B 不存在(脏引用)**:A.next 照写,B 那边的 prev 不动(无文件可改),前端 UI 兜底"原作品已删除"
    - **不重定向**:delete_book 清理脏引用时**不**自动把 A→Y→B 拼成 A→B,只把脏引用清掉(用户原意是显式的,不擅自重写)
    - **写盘策略**:prev_season_id 跟 next_season_id 同款 —— Some(非空)才写 frontmatter,空串 / None 不写;老文件缺字段 → None(向后兼容)
    - **updated 刷新策略**:A 自己 persist 走 updated = now_iso()(用户主动编辑);B / C / D 的 persist **不刷** updated(结构性维护,不是用户主动编辑)
35. **测试 fixture 陷阱:`write_book` ID 不自增**:每个 `write_book` 内部 `make_base_id(existing_ids.iter())` 取 max+1,测试里连续 `write_book(... &HashSet::new())` 4 次会得到 4 本 ID 都是 "1" 的 book(因为每次 existing 都是空),断言 `assert_ne!(a.id, b.id)` 失败 / IPC `set_next_season` 触发 self-loop("下一季不能指向自己")。**正确做法**:维护一个 `existing: HashSet<String>`,每次 write_book 后 `existing.insert(book.id)`,再传给下一次。本仓库其他测试 (`make_base_id_then_write_then_read_round_trip` / `second_write_uses_next_id` / `legacy_tv_set_seasons_round_trip`) 都遵守这个规矩,v1.6 新增的 `set_next_season_two_way_sync` / `delete_book_clears_season_chain_references` 第一次踩到了这个坑已修。**通用规则**:测试里**任何** `write_book` 多次调用都得手动维护 existing IDs 链
36. **v1.5 wikilink `[[角色名]]` 实现要点**(2026-09):
    - **数据格式不变 + 后端零改动** 是核心设计决策 —— `[[小明]]` 原样存进 frontmatter 字符串,只在渲染层识别。**理由**:让 wikilink 完全可逆(用户随时 grep / 手编辑 frontmatter / 跨机器同步无破坏),跟 Obsidian / Logseq 同款。代价:每次渲染要 parse,但 wikilink 文本量小(单条几 KB),parse 几十次完全够用。如果未来有性能问题再加 links.json 索引。
    - **大小写敏感 + 精确匹配**(trim 后比对):避免英文作品 `Alice` vs `alice` 误匹配;模糊匹配 / 别名 / 拼音留后续。
    - **`[[` 重复触发防护**:`useWikilinkTextarea` 检测 `value.slice(cursorPos - 2, cursorPos) === '[['` 时还要检查 `cursorPos - 1` 之前不是 `[`,排除 `[[[`(用户在 `[[` 后又敲 `[`)的中间触发。
    - **`setTimeout(0)` 重置光标**:React 18 在 onChange 同步调用 setValue 会触发 re-render,直接在 onChange 末尾 `setSelectionRange` 会被覆盖。**正确做法**:包一层 `setTimeout(() => ta.setSelectionRange(...), 0)` 等 React commit 后再设光标,跟 `requestAnimationFrame` 等价但更轻。
    - **跨组件跳转走 store 字段**:CharactersPanel 用本地 `useState(expandedId)` 管展开,但跨组件跳转需要全局信号。**方案**:store 新增 `navigateToCharacter: { bookId, characterId } | null` 字段,CharactersPanel useEffect 监听并匹配自己 bookId 时展开,**然后清回 null**——避免"同 character 再次点击"无法再次触发。
    - **断链创建后自动 navigateLocal**:`WikilinkCreateCharacterModal.onCreated` 回调里父组件调 `navigateLocal(bookId, characterId)`,让用户立刻看到新角色已就位(比单纯"modal 关闭 / 渲染刷新"更友好)。
    - **`splitWikilinkSegments` 边界**:未闭合 `[[` 时,**不要把 `[[` 之前的 plain 段先 flush 再把后续当 plain** —— 这会拆成两个 plain 段(测试失败案例)。**正确做法**:把 buf 跨整段累积,遇到未闭合 `[[` 时直接 `buf += text.slice(open)`,让整段(包括未闭合 `[[`)落在一个 plain 段里。
    - **localeCompare 平台差异**:`'三体'.localeCompare('百年孤独', 'zh')` 在 Node 默认 ICU 上**按 pinyin 排**(bai < san → 返回 -1,即 `百年孤独 < 三体`),不是按 Unicode codepoint。测试时**不要断言具体顺序**(`['三体', '围城', '百年孤独']`),断言「相邻对相对顺序与 localeCompare 一致」即可 —— 跨平台 / 跨 ICU 版本稳定。
    - **`RefObject` vs `MutableRefObject`**:useWikilinkTextarea 返回的 `taRef` 类型选 `MutableRefObject<T | null>`,因为 StampRow 这种需要把 hook 的 ref 与自己的 `textareaRef` 合并(callback ref 同时写两个),`RefObject<T>` 的 readonly current 写不进去。
37. **v1.5 wikilink 已知限制**(2026-09):
    - **picker 中间输入处理**:picker 打开后用户在 textarea 继续敲的内容会被 `value.slice(cursorPos)` 截到 after 段,最终插入后追加在 `]]` 后面(产生重复)。**解决**:user 打闭合 `]]` 自动删掉(`after.startsWith(']]')` 时 `endTrim = 2`),但用户敲其他字符不处理。这是已知行为,记入 dev-notes;彻底解决需要监听 picker's focus state 让 textarea 在 picker 打开时只读,留后续。
    - **跨作品跳转不重定向**:删除被引用 book 后 wikilink 变 broken,需要用户手动重新链接。**不**自动扫描 wikilink 改成指向别的同名角色(用户原意是显式的,不擅自重写)。
    - **TimeStamp.note 单行 textarea 的 picker 高度**:stamp 自动撑高是依赖 `[stamp.note]` useEffect;picker 插入 `[[name]]` 后 useEffect 触发,scrollHeight 重算正常。**边界**:用户连续敲 `[[小明]]`(`[[` 触发 picker → Esc 关闭 → 继续打 `明]]`),新字符 `明]]` 落在 picker 触发位置之后,会被 `after` 段保留;不会有 wikilink 拼写错乱。
38. **v1.7 「系列」—— 踩过的 6 个坑**(2026-09 加 series 概念):
    - **共享边界判定**:v1.7 「系列」是 **book-tracker 领域专属**(life-tracker 没"几季 + 衍生作品"诉求),**整条栈留在 app**:类型 (`Series / SeriesInput / SeriesPatch / SeriesFile`) + 路径 (`data/series.rs` + `data/config.rs::paths::series_file`) + 读写 + IPC (6 个) + service + UI + store。`tracker-core` 不持有任何领域专属概念。判定方法:问"life-tracker 也会需要且语义完全一致吗?"—— 否 → 留 app。
    - **单向引用 vs 双向维护**:`Book.seriesId` 单向引用 + `Series` 实体**不维护反向数组** `members`。理由:series 是无序收藏夹,无需 prev/next 概念;双向数组会让 series 删除 / 改名时需要级联更新 book 端,复杂且容易脏。renderer 端从 `books` 全量扫一遍聚合即可得到"某系列下所有作品",数据量小(几百本)性能完全够用。**`clear_series_references` 仍需在 delete_series 路径调一次**(单向清理指向已删 series 的脏引用,跟 delete_book 清理 nextSeasonId 同款)。
    - **不走 BookPatch 的关联字段**:跟 `nextSeasonId` / `prevSeasonId` 同款 —— `seriesId` 不在 `BookPatch` 里。理由:关联字段走专用 IPC (`books_set_series`)便于将来加校验(目标 series 不存在 / 重名 / 自动重定向等策略)+ 系列删除时的反向引用清理集中处理。`BookInput` 可以有 `seriesId`(创建时直接归入),但**不允许**通过 `update(id, patch: { seriesId })` 改 —— 这是约定的边界,`BookPatch` 不加该字段作为类型层兜底。
    - **写盘稀疏策略统一**:series 的 `name` 空 → **拒绝创建**(前端 + service 双重校验);`notes` 空 → 不写 frontmatter;`Book.seriesId` 空串 / undefined → 不写 Book.frontmatter。这跟 `notes / starring / screenwriter / nextSeasonId / prevSeasonId` 同款"空值不写盘" —— 避免污染 frontmatter,让 git diff 友好。
    - **`data::series` 容错跟 `ranking` 同款**:走「优先 JSON 解析,坏数据降级为默认值」模式 —— `version=0 / 缺 version / series 数组缺损 / 单条 series id 或 name 缺一不可(否则跳过该条)」,**不抛错**。理由:跟 books.rs 容错策略一致(避免坏数据让整个 series.json 不可读,影响所有 book 的 seriesId 渲染)。
    - **`SeriesPickerModal` 「新建后自动选中」实现**:用 `useRef<number>` 跟踪 `seriesList.length` 上一次见到值,useEffect 监听 `seriesList.length` 增长(创建成功后自动触发) → 选 `seriesList[seriesList.length - 1]`。**初值要排除「首次打开时列表从 0 → 已有」的初始填充**(否则打开 picker 后立即选第一个);**正确做法**:`lastSeriesCountRef.current` 在 `open` 变化时同步设为当前 length(初始填充算 no-op),只有 length 在已有值基础上增长才算"新建了"。
    - **PowerShell `Set-Content -Encoding utf8` 在 PS 5.1 写入中文会乱码**:实测 PowerShell 5.1 用 `Set-Content -Encoding utf8` 写 UTF-8 中文会被以系统 ANSI(GBK)写入,中文 mojibake;**正确做法**:**永远不要用 PowerShell 命令截断 / 改写含中文的 UTF-8 文件**。如果需要类似操作,用 `git checkout` 恢复 + 用 edit 工具精确替换。我曾用 `(Get-Content $f) | Select-Object -First 493 | Set-Content` 删一个文件的重复段,结果整个文件中文全部 mojibake(被静默写为 GBK),最后 `git checkout -- file` 恢复。教训:**任何"用 PowerShell 操纵 UTF-8 CJK 文件"的操作都先 git stash 或 backup,做完立刻 diff 看有无乱码**。
39. **v1.7 `Book.seriesId` 单字段 `rename = "seriesId"` 不整体 `rename_all = "camelCase"`**(`types.rs` 顶层字段):Book 不整体用 camelCase 序列化(会破坏 TS 端 `book.read_count` 等 8 处 snake_case 访问);其他需要 camelCase 的字段(`nextSeasonId` / `prevSeasonId` / `seriesId` / 嵌套 struct 的 `episodeCount` / `lastModified`)用单字段 `rename` 或局部 `#[serde(rename_all = "camelCase")]` 兜底。**新增 camelCase 字段时**:加 `#[serde(rename = "...")]`,在 `normalize_book` + `persist` + `parse_*` 同步加 frontmatter 读写(否则 IPC payload 被 Tauri 2 静默吞,数据丢失),typecheck 不会报(因为默认 serde 字段名 = Rust 字段名 snake_case),需要单元测试覆盖。v1.6 已经踩过这个坑(见 §十.25 末尾),v1.7 seriesId 严格对齐模式。
40. **v1.8 Modal-in-Modal 反模式 → 拆出「*Fields / *View」组件**(2026-09 合并统一 AddModal 时踩):v1.7 加「TopBar 系」按钮后,BookForm / SeriesModal 都自带 `<Modal>` 包装;v1.8 要把它们收口到「+ 添加」一个 Modal 时,**直接 `<Modal>{<Modal />}</Modal>` 嵌套会导致** backdrop 双重叠加、Esc 关闭竞态、点 backdrop 关闭两次。**正确做法**:**把原组件的 `<form>` / `<div>` body 抽到不带 Modal 包装的新文件**(BookFormFields / SeriesView),由 AddModal 提供唯一 Modal,tabs 内容是纯 body。**审查 Modal 复用性**时:任何"想把这个组件塞到另一个 Modal 里"的场景,先检查它是否自带 Modal —— 是就拆。本规则也适用于其他被嵌场景(WikilinkProvider 内部的 picker / create modal 同款处理)。
41. **v1.8 统一 AddModal tab 默认值 + 切换保留局部状态**:tabs 默认「+ 作品」是主要场景(用户加系列频率低),加 book = 立即打开加作品表单;tabs 切换不重置 BookFormFields / SeriesView 内部 state(用户切回原 tab 保留已填字段)—— 通过 `useState(initialTab)` 在 AddModal 顶层持有 tab,内部 body 用 key / remount 控制重置(本轮未实现,留后续若发现表单状态被错乱恢复)。**判定**:用户在某个 tab 填了一半切到另一个 tab,切回来字段应还在。
42. **v1.8 BookForm 编辑模式移除路径**:v1.6 起 BookDetail 走内联编辑(底部「保存」统一写盘),BookForm 只剩「加作品」路径。v1.8 拆 BookFormFields 时**彻底删除 book 接收**(只接 onClose),不再保留 `book: Book | null` 参数化(无 caller,无意义保留)。后续若需要「编辑作品弹窗」,由新组件 `BookEditModal` / 加 AddModal 新 tab 承载,不复用 BookFormFields。**判定**:重构时看 caller 链 —— 没 caller 就别留参数化。

## 十一、已实现功能清单

- [x] 加作品：作品名 / 作品类型（书、动画、电视剧、电影、其他）/ 作者·主创 / 国家 / 年份 / 译者
  - **类型感知字段标签**：按 `WorkKind` 自动切换"作者/原作/主创/导演"、"出版/开始/首播/上映年份"、"原产国/制片国家"；"译者"仅书显示，"主演"仅 movie/tv 显示 —— 两者位置对称,UI 不会同时出现
- [x] 编辑作品 —— **详情页就地内联编辑**(BookDetail)，不再走弹窗表单；底部「保存」统一写盘
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
- [x] 全局快捷键：`n` 添加（作品 / 系列 tab 切换） / `g` 关系图 / `r` 排名 / `e`/`c` 切模式 / `Esc` 清搜索
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
- [x] **笔记实际修改日期保留**（`EpisodeRecord.lastModified` / `SeasonInfo.lastModified`,v1.5 新增）—— 用户核心诉求"点进去但什么都没改,老时间不变"
  - `lastModified: number`(毫秒)出现在 EpisodeRecord 和 SeasonInfo 顶层;note / title / stamps 任一被改时刷
  - **关键决策**:`watched` toggle / `episode_bump` 联动 / 季号 / 集数变化**不刷** `lastModified`(用户期望"什么都没改,老时间不变")
  - 空串"删笔记" / 空数组"删 stamp"**不刷**(结构变更 ≠ 笔记内容变更)
  - UI:展开区底部显示"最后修改:YYYY-MM-DD HH:MM";季标题里也可展示
  - 写盘策略:`Some(非 0)` 写盘;`None` / `0` 不写;老文件缺字段 → 读回 `None`(向后兼容)
- [x] **角色笔记**（`Book.characters: Character[]`,v1.5 新增,**所有类型**都能用）—— 给"人物 / 主角 / 配角 / 阵营 / 组织"做独立笔记
  - `Character = { id: UUID, name: 必填, notes?: 可选, lastModified?: 毫秒 }`
  - **关键决策**:所有类型(书/动画/电视剧/电影/其他)都能用,不只是 tv/anime
  - 写盘策略:空数组 / 全 name 空 → 不写 frontmatter;单条 character name 空 → 跳过该条;notes 空串 → 不写 notes 字段(保留 character 实体);lastModified undefined / 0 → 不写
  - UI:`CharactersPanel`(参考 EpisodesPanel 风格:列表 + 展开区 + 新增/删除);CharacterRow 头部显示名字 + 📝 标记 + 最后修改时间;展开后有名字输入 + 笔记 textarea + 删除按钮
  - **整段 setCharacters IPC**(跟 setSeasons / setEpisodeStamps 同款),组件在 add/edit/remove character 时构造新数组,**只对"被改的那条"刷 lastModified**
  - 顺序:用户主动 add 顺序(用 `Vec<Character>` 而不是 BTreeMap —— 跟 EpisodeNotes 的语义区别)
- [x] **进度 +1/-1 联动集笔记**（`books_episode_bump` command）—— `+1` 时线性遍历 seasons,把接下来 N 个未看集标 watched;`-1` 不动 episodes(允许用户保留笔记 / 标记状态)
- [x] **季结构就地编辑**(v1.4 新增,仅 tv/anime;v1.6 简化) —— 详情页「集笔记」面板可直接改季结构,**不再退回 BookForm**:
  - 「X 集」inline `<input type="number">`:季标题里改单季集数,失焦/回车写盘(本地 draft 防抖,空串/非法值还原)
  - 「删除此季」按钮:整段 setSeasons 过滤掉当前季,带 confirm 提示,旧 episodes key 按决策 B 保留
  - 不联动改 `book.progress.total`(理由见 §十.25)
  - **v1.6 移除**:
    - 顶部季选择器 tabs(S0X 标签 + ◀ ▶ 切换按钮)—— 用户约定"不同季用 nextSeasonId 串成多本 book",每本只追踪一季,季选择器已无意义
    - 「+ 季」按钮—— 加新季走"新建一本 book + 设下一季"路径
- [x] **「下一季」关联**（`Book.nextSeasonId`,v1.6 新增;tv/anime 实际使用）—— 把多季剧拆成多本 book 时串成季链
  - 走专用 IPC `books_set_next_season`(同 seasons / episodes / characters 模式,不进 BookPatch)
  - self-loop 校验(id === nextSeasonId → Err),目标不存在不拒绝(前端 UI 兜底"原作品已删除")
  - 候选排除自己,tv/anime 优先,按 title 升序,**不截断**(v1.6 fix:之前 `.slice(0, 12)` 导致搜索 13+ 同名书搜不到)
- [x] **「上一季」自动反向同步**（`Book.prevSeasonId`,v1.6 新增,与 `nextSeasonId` 配对）—— 在 `set_next_season` 路径**自动维护**,不暴露 IPC 命令
  - 同步策略:A.next = B → A.next = B, B.prev = A;改链 / 清链自动清理旧关联(C.prev 清 / D.next 清)
  - delete_book 同时清理指向被删 book 的 next + prev 引用,**不**自动重定向(用户原意不擅自改)
  - UI:BookDetail 在「下一季」区块**上方**加「上一季」区块(只读跳转,无"设置"按钮 —— 全自动)
- [x] **「系列」收藏夹**（`Series` 实体，v1.7 新增；无序归组）—— 解决"几季 + 衍生作品全部摊开很占空间"的诉求
  - 数据层：`<data_dir>/series.json` 单文件存所有 series + 各 book 的 `seriesId` 单向引用（**不**维护反向数组，renderer 端从 books 全量聚合）
  - `Series = { id: 数字, name: 必填, notes?: 简介, created, updated }` —— 不进 BookPatch（走专用 IPC）
  - 6 个 IPC：`series_list / series_get / series_create / series_update / series_delete / books_set_series`
  - **共享边界**：仅进 book-tracker（life-tracker 没这场景）；类型 / 路径 / 读写 / IPC / 业务方法全留 app，tracker-core 不持有任何领域专属概念
  - **跟「下一季」的关系**：`nextSeasonId` 是"线性季链"（有方向），`seriesId` 是"无序归组"；两者独立可共存（同一部书可既在系列里又指向下一季）
  - 删除联动清理：删除 series → service 层扫所有 books 把 `seriesId == id` 的清空（跟 delete_book 清理 nextSeasonId 同款单向清理策略；不重定向）
  - UI：
    - **v1.8 起**：「+ 添加」按钮 → `AddModal`「+ 系列」tab：顶部 inline 新建 + 列表管理（编辑 inline + 删除 confirm + 显示成员数 `(N 本)`）。**不再有 TopBar「系」按钮 + 「s」快捷键** —— 加系列入口收口到「+ 添加」入口（v1.7 在 TopBar 加按钮被用户否定："想要统一在加作品按钮里,但条目内容不一样"）
    - BookDetail 加「所属系列」区块（在「下一季」区块之后），含：当前系列跳转 + 同系列其他作品 chip 列表（去重自己，最多 8 本 + overflow 提示）
    - 「设置系列」走 `SeriesPickerModal`（紧凑搜索 + 「+ 新建系列」入口，**新建后自动选中** —— 用 ref 跟踪列表长度变化）
    - 「原系列已删除」脏引用兜底（同 NextSeasonPicker 同款优雅降级）
  - **写盘策略**：`name` 空 → 拒绝创建（前端 + service 双重校验）；`notes` 空 → 不写 frontmatter；`seriesId` 空串 / undefined → 不写 Book.frontmatter
  - **持久化**：`data/series.rs` 自写 read/write（不走 serde），跟 `data/ranking.rs` 同款顶层 JSON 文件模式；稀疏策略 + 容错（缺 id / name 的 series 读时跳过；version=0 → 1）
- [x] **RANK 按季拆分**（v1.2 排名细化）—— tv/anime 按季独立排名,rankId = `${bookId}#${seasonNumber}`;其他 kind 保持原 rankId;对比卡片 / 排名列表都加「S0X」徽标
  - 解决:大明王朝(46 集单季) 跟 绝命毒师(7+13+13+13+16 五季) 放一起比不合理
  - **v1.6 决策**:RankingList / RankingCompare 的「S0X」徽标**保留**(不是季切换 UI,只是"排名时这一行是哪一季"的标识,跟 EpisodesPanel tabs 是不同概念)
- [x] **作品双链 `[[角色名]]`**（v1.5 新增,所有 4 处自由文本字段都支持）—— Obsidian 风格 wiki-link,笔记里点名词跳到角色笔记
  - **数据格式不变**:`[[小明]]` 原样存进 frontmatter 字符串(同 Obsidian / Logseq);**后端 / IPC / Rust / 数据层全部零改动**,只在渲染层识别
  - **支持字段**:Book.notes / Character.notes / EpisodeRecord.note / TimeStamp.note(全部 4 处 textarea 集成)
  - **写入策略**:
    - 输入 `[[` 触发全局 picker(候选 = 当前 book 全量 character);↑↓ 选 / Enter 确认 / Esc 关闭;支持搜索过滤 + 「+ 创建新角色」入口
    - picker 关闭自动插入 `[[name]]`,光标落到 `]]` 之后
    - 直接打 `[[新名字]]` 不开 picker,文本原样存,渲染时自动标「断链」
    - 复用 hook `useWikilinkTextarea(book, value, setValue)` 把「`[[` 检测 + 插入 + 光标定位」统一封装
  - **解析语义**(`resolveWikilink` 纯函数):
    - **local** —— 当前作品找到该 character;点击 → 滚到 CharactersPanel 并展开
    - **global-unique** —— 当前没有,跨作品唯一命中;点击 → 切到目标 book + 展开
    - **global-multi** —— 跨作品多条同名;点击 → 弹跨作品 picker,选完跳转
    - **broken** —— 哪里都没找到;点击 → 弹「创建角色『xxx』」modal,确认后跳到新角色
  - **大小写敏感 + 精确匹配**(trim 后比对);避免英文作品大小写误匹配;模糊匹配留后续
  - **新 store 字段**:`navigateToCharacter: { bookId, characterId } | null` + `setNavigateToCharacter` action —— CharactersPanel 监听并消费后清回 null
  - **新组件**:
    - `WikilinkText` —— 渲染层(plain + 可点击 wikilink 段)
    - `WikilinkPickerModal` —— 紧凑搜索 + 列表 picker(参考 NextSeasonPicker)
    - `WikilinkCreateCharacterModal` —— 断链创建新角色
    - `WikilinkContext` (Provider) —— 全局协调层;picker / create 模态全局唯一
    - `useWikilinkTextarea` —— textarea `[[` 检测 + 插入 hook
  - **共享边界**:纯函数 + 测试留 `apps/book-tracker/src/shared/`(绑定 Character,留 app);渲染 / 协调 / 集成全留 `apps/book-tracker/src/renderer/components/`(领域 UI);tracker-core / tracker-ui / Rust **零改动**
  - **测试**:40 个 vitest(`apps/book-tracker/src/shared/__tests__/wikilink.test.ts`):parseWikilinks 12 / splitWikilinkSegments 8 / resolveWikilink 12 / candidates 8
- [x] 关系图（react-force-graph-2d，500 节点流畅，节点下方画 tag chip）
- [x] **作品排名**（两两对比 Elo 评分）：TopBar「排」按钮 / 快捷键 `r` → Modal
  - kind 切换（书/动画/电视剧/电影/其他）+ 各 kind 已读数量徽标
  - 排名列表 tab：按 Elo 评分倒序，条形图可视化，标题 / 作者 / 对比次数 / 评分
  - 对比 tab：左右两本候选（标题 + 作者 + 年份 + 国家 + tags），点击选 winner，支持「跳过」「平局」
  - 池 = `status === 'finished'` 且 `kind === 选中 kind` 的书
  - 评分算法 + pair 选择策略进 `packages/tracker-core/src/ranking.ts`（领域无关，未来 goal-tracker 可直接复用）
- [x] **统一「+ 添加」入口**（`AddModal`,v1.8 新增）—— 把加作品 / 加系列 / 管理系列 三个 modal 收口到**单一按钮 + tabs**
  - **TopBar「+ 添加」按钮（快捷键 `n`）** → AddModal,tabs 在 [+ 作品] / [+ 系列] 之间切换
  - 「+ 作品」tab → `BookFormFields`（从原 BookForm 抽出的纯 form body，无 Modal 包装）—— 加作品完整表单
  - 「+ 系列」tab → `SeriesView`（从原 SeriesModal 抽出的纯列表 body，无 Modal 包装）—— 顶部 inline 新建 + 列表管理（编辑 + 删除 + 成员数）
  - **共享 Modal**：`AddModal` 是唯一 Modal,tabs 内容均不含 Modal 包装 —— 避免 Modal 内嵌 Modal 的不可控行为
  - **footer 策略**：「作品」tab footer = 「取消」+「保存」(由 BookFormFields 内部 form id="book-form" 触发提交);「系列」tab 无 footer(自身有 CRUD 按钮 + 右上 × 关闭)
  - **设计动机**：v1.7 加「TopBar 系」按钮被用户否定 —— "想要统一在加作品按钮里,但条目内容不一样"。**统一入口 + tabs 切换 + 内容差异化** 同时满足两个诉求
  - **共享边界**：跟原 Modal 同款 —— 整条栈留 app(纯 UI 抽象,无领域字段;SeriesView / BookFormFields 通过 zustand store 调用领域 IPC)
- [x] **「系列」成员管理入口（v1.9 新增,SeriesView 一侧 drill-down）**—— 解决"想从系列侧管理成员,不必逐本 BookDetail 进进出出"的诉求
  - **数据层/IPC**：零改动 —— 复用现有 `books_set_series`(单本版)+ 在 renderer 层串行包装成批量(无需新 IPC)
  - **UI**：在「+ 添加」→「系列」tab 内,series 列表行变成可点击
    - 行点击 → 切到 `SeriesDetailBody`(展示系列元信息 + 成员作品列表 + 「× 移除」按钮 + 「+ 添加作品」按钮)
    - 「+ 添加作品」 → 切到 `SeriesPickBooksBody`(多选 picker:搜索 / 全选当前筛选 / 显示「已在其他系列」hint)
    - 「加入系列」→ 批量串行调 setSeries,**部分失败 alert 列出失败清单**(不全部回滚,成功的留)
  - **三态 view 状态机** (`SeriesView` 内):`'list' | 'detail' | 'picker'`,全部在 AddModal 内部切换,**严禁 Modal 嵌套**(v1.8 反模式 §十.35 的延续 —— 用 view state 而不是真弹新 Modal)
  - **行为细节**:
    - 「已在其他系列」作品可在 picker 选中,确认时弹 confirm 提示「加入会替换旧引用」,确认后串行 setSeries 替换(单向引用语义,跟 BookDetail 设系列同款)
    - 「× 移除」单本 setSeries(book.id, null),**无 confirm**(跟 BookDetail 的 × 移除系列同款,误点可加回)
    - 删除整个系列时若正好在 detail / picker 视图 → 自动回到 list(防止 selectedSeriesId 指向已删 series 的悬空)
    - 行可点击的子元素(「编辑」/「删除」)用 `e.stopPropagation()` 隔开(不点中)
  - **新文件**:
    - `SeriesDetailBody.tsx` —— 成员管理 body(无 Modal 包装,「+ 添加作品」+ 移除 × + 系列名/notes/计数)
    - `SeriesPickBooksBody.tsx` —— 多选 picker body(无 Modal 包装,搜索 + checkbox 全选 + 「加入系列」footer)
  - **共享边界**：跟原 series 同款 —— 整条栈留 app;无新 IPC、无新 data 层、tracker-core / Rust / crates/tracker-core **零改动**
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
├── series.json           # 系列收藏夹（v1.7 加，单文件存所有 series）
├── relations.json        # 前置关系图（懒创建）
├── rankings.json         # 排名历史：两两对比记录（懒创建）
└── config.json           # 用户配置（含 data_dir 自身）
```

**与代码仓分离**：用户数据含个人阅读历史，建议在数据目录单独 `git init` 并推到**另一个** GitHub 仓库，**不要**跟代码混在一起。
