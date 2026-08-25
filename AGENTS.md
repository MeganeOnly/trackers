# AGENTS.md — book-tracker 项目 onboarding

> **给后续 agent 看的开发指南**。本文件应随项目一起 commit；不含本机路径 / 私人化信息。

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
│   └── Modal.tsx                 # 通用 modal（footer 槽位）
├── pages/
│   ├── EditMode.tsx              # 编辑模式壳（BookList + BookDetail）
│   └── CleanMode.tsx             # 日常模式（"现在能读哪本"）
├── store/                        # zustand store（每个领域一个文件）
│   ├── books.ts
│   ├── relations.ts
│   ├── mode.ts                   # clean / edit
│   ├── search.ts                 # 全局搜索 query
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
    ├── types.rs                  # Book / Edge / Progress / Config / BookPatch 等 serde 镜像
    ├── progress.rs               # 章节进度纯函数 + 单元测试
    ├── unlock.rs                 # compute_unlocked + 环检测 + 单元测试
    ├── data/                     # 文件 I/O 层
    │   ├── books.rs              # 每本书一个 .md(JSON frontmatter + 手写 split_frontmatter)
    │   ├── relations.rs          # relations.json
    │   ├── config.rs             # config.json
    │   ├── files.rs              # atomic_write / ensure_dir / read_json
    │   └── slug.rs               # make_base_id(纯数字 ID)
    ├── service/                  # 业务逻辑层(调用 data/,对 commands 暴露)
    │   ├── books.rs
    │   ├── relations.rs
    │   ├── config.rs             # ConfigPatch(不允许改 data_dir)
    │   └── data_dir.rs           # 双仓分离 + Mutex<Option<String>> 全局 cache
    └── commands.rs               # 12 个 #[tauri::command] + 1 个 app_ensure_data_dir

src/shared/                       # 跨进程共享类型(被 renderer 用,Rust 端有 serde 镜像)
├── types.ts                      # Book / Edge / Progress / Config / BrokenEntry
├── api.ts                        # ElectronAPI 接口定义(被 renderer 用)
├── unlock.ts                     # computeUnlocked(纯函数,有测试)
├── progress.ts                   # parseProgress / bumpProgress / formatProgress(纯函数)
└── __tests__/                    # vitest 单测
    ├── unlock.test.ts
    └── progress.test.ts
```

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
  "tags": []
}
---

# 百年孤独

## 笔记
...（自由写）

## 摘录
...（自由写）
```

**frontmatter 序列化约束**：

- **Rust 端手写 JSON**（`split_frontmatter` 函数，~30 行，优先 JSON 解析，失败 fallback 空对象）
- `progress` 字段写为 `"progress": { "current": 12, "total": 100 }`（单行 JSON）或省略（无进度时）
- 字段缺损 / 类型错误时**容错为 `null`**，不抛错——否则会破坏旧书文件
- 不要把 `progress: null` 写进 frontmatter（`write_book` 已经做了"有值才写"的判断）

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
| `finished` | 已读 | **是** |
| `abandoned` | 弃读 | 否 |

只有 `finished` 才算"已掌握"，才会让前置它的书解锁。

## 六、解锁规则（`computeUnlocked` / `compute_unlocked`）

- `all`：所有前置 `finished` 才解锁
- `any_of`：至少 `threshold` 个前置 `finished` 才解锁
- 无前置：永远解锁
- **循环依赖**：被检测到的环上的书**全部置为不解锁**，不参与解锁计算
- 性能：带 memo 的迭代 DFS，单测已覆盖
- TS 端在 `src/shared/unlock.ts`，Rust 端在 `src-tauri/src/unlock.rs`，二者逻辑等价（TS 用于 renderer 实时计算，Rust 用于校验）

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
# 开发
npm install              # 装包
npm run dev              # tauri dev(启动 Vite + 编译 Rust + 打开原生窗口，带热重载)
npm run dev:vite         # 只跑 Vite dev server(1420)，不编译 Rust(纯 renderer 调试用)

# 构建
npm run build            # tauri build(产物: src-tauri/target/release/bundle/nsis/*.exe)
npm run build:vite       # 只跑 vite build(产物: dist/，供 tauri build 消费)

# 校验
npm run typecheck        # tsc 双段(node: vite.config.ts；web: renderer + shared)
npm test                 # vitest run(renderer/shared 纯函数)

# Rust 后端（单独验证）
cd src-tauri && cargo test    # 61/61 单元测试
cd src-tauri && cargo build   # 全量编译(debug profile)
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

## 十一、已实现功能清单

- [x] 加书：书名 / 作者 / 国家 / 年份 / 译者
- [x] 编辑书（Modal 复用加书表单）
- [x] 删除书（confirm 提示）
- [x] 状态切换（5 种）+ 快速按钮（在详情页）
- [x] 第 N 次读（`read_count`，仅 `reading` 时）
- [x] **章节进度**（`progress: { current, total }`，仅 `reading` 时，详情页有 `-1 / +1 / +5 / 读完` 快速按钮）
- [x] 前置依赖编辑器（多对多）
- [x] 解锁规则：`all` / `any_of` + threshold
- [x] 循环依赖检测
- [x] 日常模式：自动列"现在能读的书"，按反向度数排序
- [x] 日常模式：搁置/已读/弃读折叠区
- [x] 编辑模式：按状态分组的侧边栏
- [x] 全局搜索（书名 / 作者 / ID 模糊匹配）
- [x] 全局快捷键：`n` 加书 / `g` 关系图 / `e`/`c` 切模式 / `Esc` 清搜索
- [x] 关系图（react-force-graph-2d，500 节点流畅）
- [x] 用户数据目录 picker（首次启动）
- [x] 数据目录结构初始化（picker 完成后同步写 `config.json` + `books/`，避免空壳）
- [x] 配置文件 `config.json` 持久化
- [x] vitest 单测（unlock + progress，renderer/shared）
- [x] Rust 单元测试（progress + unlock，61 个 case 全过）
- [x] Tauri 端到端接通（renderer invoke → Rust command → 文件 I/O）

## 十二、未实现 / 后续可加

- [ ] `tags` 字段 UI（后端已支持，前端表单未暴露）
- [ ] 笔记（Markdown）读写（占位字段已写 `## 笔记`，未实现编辑器）
- [ ] 数据导入/导出（JSON / CSV）
- [ ] 备份 / 还原
- [ ] 多用户数据目录切换 UI（已支持切换，但需重启应用）
- [ ] 国际化（目前硬编码中文）
- [ ] GitHub Actions release workflow（构建 + 发 Release）
- [ ] `docs/architecture.md`（README 里有占位，待补）

## 十三、测试规范

- **TS 纯函数测试**放 `src/shared/__tests__/*.test.ts`，跟被测代码同目录或就近
- **Rust 纯函数测试**用 `#[cfg(test)] mod tests { ... }` 内联在被测文件底部
- TS 测试用 vitest 的 `describe / it / expect`；不要 jest 的 `test()`
- Rust 测试用 `#[test]` + `assert_eq!`；每个被测函数至少 2-3 个 case
- 跑：TS `npm test`（CI 模式）或 `npm run test:watch`（开发模式）；Rust `cd src-tauri && cargo test`
- 每次加新的 pure function（不依赖 fs / Tauri），必须带测试
- 加 Tauri command 时，如果逻辑复杂（不是单纯 dispatch），把核心逻辑抽到 `service/` 层并加 cargo test

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
└── config.json           # 用户配置（含 data_dir 自身）
```

**与代码仓分离**：用户数据含个人阅读历史，建议在数据目录单独 `git init` 并推到**另一个** GitHub 仓库，**不要**跟代码混在一起。
