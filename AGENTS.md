# AGENTS.md — book-tracker 项目 onboarding

> **给后续 agent 看的开发指南**。本文件应随项目一起 commit；不含本机路径 / 私人化信息。

## 一、定位

**book-tracker** 是一个本地书籍追踪器（Electron 桌面应用），管理：

- **想读的书** + **前置依赖**（多对多网状结构，自动算"现在能读哪本"）
- **状态**：`want` / `shelved` / `reading` / `finished` / `abandoned`
- **章节进度**：记录连载小说的"第 N / 总 M 章"
- **关系图**：力导向可视化

**不是**一个云同步、社交、推荐类应用。**纯本地**，用户数据和应用代码**完全分离**（代码仓 vs 数据仓是两个独立 repo）。

## 二、技术栈与决策

| 维度 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Electron 33 | 用户已装 + Windows + 离线 |
| 构建 | electron-vite 2 + Vite 5 | 三段产物（main / preload / renderer）分开 |
| UI | React 18 + TS | 主流，无构建魔法 |
| 状态 | zustand 5 | 无 Provider / 无 Redux 模板代码 |
| 文件存储 | 每本书一个 `.md` + `relations.json` | 用户数据可直接 `git init` 进 GitHub |
| frontmatter | gray-matter | YAML frontmatter + Markdown body |
| ID 生成 | 纯递增数字（`makeBaseId` 取 max+1） | 简洁、文件名短、天然唯一 |
| 关系图 | react-force-graph-2d | 力导向，500 节点流畅 |
| 测试 | vitest 4 | 与 Vite 同源，单测友好 |

**未引入**的状态管理 / 路由 / UI 库——刻意保持小。如果将来要加，按"是不是真的需要"判断，不要为了"现代化"而引入。

## 三、目录结构

```
src/
├── main/                     # Electron 主进程（Node.js 上下文）
│   ├── index.ts              # 主进程入口（窗口创建、注册 IPC）
│   ├── ipc/index.ts          # IPC 通道注册（dispatch 表）
│   ├── service/              # 业务逻辑层（调用 data/，对外暴露 API）
│   │   ├── books.ts
│   │   ├── relations.ts
│   │   ├── config.ts
│   │   └── data-dir.ts       # 用户数据目录（首次启动 picker）
│   └── data/                 # 文件 I/O 层（fs + gray-matter）
│       ├── books.ts          # 每本书一个 .md
│       ├── relations.ts      # relations.json
│       ├── config.ts         # config.json
│       ├── files.ts          # atomicWriteFile / ensureDir / readJson
│       ├── slug.ts           # makeBaseId（纯数字 ID；文件名沿用 slug.ts）
│       └── pick-dir.ts       # 系统文件夹 picker dialog
│
├── preload/                  # 预加载脚本（contextBridge 暴露 API 到 renderer）
│   └── index.ts              # window.electron.{books,relations,config,data}
│
├── renderer/                 # 渲染进程（React UI）
│   ├── App.tsx               # 顶层组件 + 全局快捷键
│   ├── main.tsx               # React 入口
│   ├── styles.css            # 全部样式（单文件，CSS Variables 主题）
│   ├── index.html
│   ├── components/           # 通用组件
│   │   ├── TopBar.tsx
│   │   ├── BookList.tsx      # 编辑模式左侧栏（按状态分组）
│   │   ├── BookDetail.tsx    # 编辑模式右侧详情
│   │   ├── BookForm.tsx      # 加书/编辑 modal
│   │   ├── PrereqEditor.tsx  # 前置依赖编辑器
│   │   ├── GraphView.tsx     # react-force-graph 包装
│   │   ├── GraphModal.tsx    # 关系图 modal
│   │   └── Modal.tsx         # 通用 modal（footer 槽位）
│   ├── pages/
│   │   ├── EditMode.tsx      # 编辑模式壳（BookList + BookDetail）
│   │   └── CleanMode.tsx     # 日常模式（"现在能读哪本"）
│   └── store/                # zustand store（每个领域一个文件）
│       ├── books.ts
│       ├── relations.ts
│       ├── mode.ts           # clean / edit
│       ├── search.ts         # 全局搜索 query
│       └── selectors.ts      # useUnlocked / useGroupedByStatus / useEdgeFor
│
└── shared/                   # 跨进程共享（main + renderer + tests 都能 import）
    ├── types.ts              # Book / Edge / Progress / Config / IPC 常量
    ├── api.ts                # ElectronAPI 接口定义（preload + renderer 用）
    ├── unlock.ts             # computeUnlocked（纯函数，有测试）
    ├── progress.ts           # parseProgress / bumpProgress / formatProgress（纯函数）
    └── __tests__/            # vitest 单测
        ├── unlock.test.ts
        └── progress.test.ts

electron.vite.config.ts       # 三段构建配置
electron-builder.yml          # 打包配置（windows nsis）
tsconfig.json / tsconfig.node.json / tsconfig.web.json
dev.bat                        # 一键 dev 启动（双击运行）
README.md                      # 用户面向文档
```

**依赖方向**（单向，禁止反向）：

```
shared  ←  main  ←  preload
   ↑        ↑
   └────────┴───  renderer
```

`shared/` 不依赖任何 Electron API，是纯函数 + 类型，可以在测试里直接 import。

## 四、数据模型与文件格式

### `Book`（一本书一个 `.md`）

```markdown
---
id: 1
title: 百年孤独
author: 加西亚·马尔克斯
country: 哥伦比亚
year: 1967
translator: 范晔
status: reading
read_count: 2
progress:                 # 章节进度（可选，仅连载小说常用）
  current: 12
  total: 100              # null / 缺失 = 连载中
created: 2024-01-15T...
updated: 2024-03-20T...
tags: []
---

# 百年孤独

## 笔记
...（自由写）

## 摘录
...（自由写）
```

**frontmatter 序列化约束**：

- `gray-matter.stringify` 默认会把嵌套对象写成 YAML 嵌套格式（`progress:` + 缩进子键），parse 端必须用 `parseProgress` 而不是直接断言对象类型
- 字段缺损 / 类型错误时**容错为 `null`**，不抛错——否则会破坏旧书文件
- 不要把 `progress: null` 写进 frontmatter（`persist()` 已经做了"有值才写"的判断）

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

## 六、解锁规则（`computeUnlocked`）

- `all`：所有前置 `finished` 才解锁
- `any_of`：至少 `threshold` 个前置 `finished` 才解锁
- 无前置：永远解锁
- **循环依赖**：被检测到的环上的书**全部置为不解锁**，不参与解锁计算
- 性能：带 memo 的迭代 DFS，单测已覆盖

## 七、架构三层（main / preload / renderer）

**加新功能的标准流程**：

1. 在 `src/shared/types.ts` 加类型（如 `Progress`）
2. 在 `src/shared/api.ts` 加 API 接口（如 `BookAPI.progressBump`）
3. 在 `src/main/data/*.ts` 加 / 改文件 I/O（持久化逻辑）
4. 在 `src/main/service/*.ts` 加业务方法（包装 data 层）
5. 在 `src/main/ipc/index.ts` 注册 IPC handler（`ipcMain.handle(IPC.xxx, ...)`）
6. 在 `src/preload/index.ts` 暴露到 `window.electron.xxx`
7. 在 `src/renderer/store/*.ts` 加 zustand store action
9. 在 `src/renderer/components/*.tsx` 接 UI
10. 在 `src/shared/__tests__/*.test.ts` 加单测（如果加了纯函数）
11. **更新 `README.md` + 本文件的"已实现功能"清单**

**反向 import 是 bug**：renderer 永远不能 import `src/main/`，反之亦然。它们只能通过 `src/shared/` + IPC 通信。

## 八、开发约定

- **TypeScript 严格模式**：所有 `.ts` / `.tsx` 走 `tsc --noEmit`；`npm run typecheck` 同时跑 node + web 两段
- **EOL**：`.gitattributes` 强制 `* text=auto eol=lf`——所有提交文件 LF
- **状态管理**：一个领域一个 store 文件，不要把多个领域塞进同一个 zustand store
- **IPC channel 常量**：所有通道名集中在 `src/shared/types.ts` 的 `IPC` 对象里，禁止字符串字面量散落
- **错误传播**：主进程函数返回的 error 直接抛，preload / renderer 用 try/catch；不要在 service 层 swallow
- **不引入未使用依赖**：装包前确认不会被 tree-shake 掉
- **commit 粒度**：一个独立逻辑单元一个 commit；如果非要合并多个改动，message body 必须说明合并理由
- **commit message 风格**：Conventional Commits（`feat(scope): ...` / `fix(scope): ...` / `refactor: ...` / `docs: ...`），scope 用领域名（`books` / `ui` / `clean` / `edit` / `graph` / `build`）

## 九、常用命令

```bash
npm install              # 装包（优先 npm，避免 github: 源）
npm run dev            # 启动 electron-vite dev（带热重载；dev.bat 双击也走这个）
npm run build          # 三段构建（main + preload + renderer）→ out/
npm run typecheck      # tsc --noEmit 两段
npm test               # vitest run
npm run test:watch     # vitest watch 模式
npm run pack           # 构建 + electron-builder --dir（不打包 installer）
npm run dist           # 构建 + 全平台 installer
npm run dist:win       # 仅 Windows x64
```

构建产物在 `out/` 和 `release/`（已 git ignore）。

## 十、踩过的坑（避免重复踩）

1. **`BookInput` 是 `Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags'>`**——加新必填字段到 `Book` 后必须同步加到 `BookInput` 类型，或在表单构造 input 时显式 `progress: null` 之类的占位
2. **`progress: null` 不能省略**——TypeScript 的 `Omit<Book, ...>` 会保留新字段，缺了会报 `Property 'progress' is missing`
3. **`gray-matter` 序列化嵌套对象**：frontmatter 里写 `progress: { current: 12, total: 100 }` 会展开成 YAML 嵌套格式——解析端必须用 `parseProgress` 容错，不能假设 `parsed.data.progress` 一定是 `{ current: number, total: number | null }`
4. **写盘判断**：`persist()` 只在 `book.progress` 真值时写 progress 字段——不要无条件 spread Book 整个对象，否则 `progress: null` 会污染 frontmatter
5. **状态切走时清 progress**：编辑表单里如果 status 从 `reading` 切到其他，要主动设 `patch.progress = null`，否则旧的 progress 会留着误导用户
6. **快速按钮走专用 IPC**：`+1 / -1 / +5` 不要走完整的 `books:update` patch 合并，专用 `books:progressBump` 通道，避免读 100 本同时点 +1 时每次都序列化整个 Book 对象
7. **cycle detection 不能漏**：`computeUnlocked` 必须先用 DFS 找出所有环，环上节点**全部置为不解锁**；漏了会让死循环里的书永远解锁（逻辑 bug）
8. **ID 唯一性**：`writeBook` 调 `makeBaseId` 取现有最大数字 ID +1 写入；忽略非数字 ID（防止老 pinyin 残留混入）。**不要**改回带后缀的 collision 方案（`-2`/`-3`）——数字 ID 之间天然唯一，无需额外处理
9. **renderer 不能 import `node:fs`**——vite 会编译失败；如果要在 renderer 用工具函数，提炼到 `src/shared/` 并确保不引 Node API
10. **`useEffect` 依赖数组**：如果用了 `useBooksStore((s) => s.x)` 这种 selector，要么确保 selector 返回稳定引用，要么用 `useShallow` 包一下——否则无限循环
11. **首次 picker 后必须初始化 data_dir**：原先 `initDataDir` 只写 userData 层 config.json，data_dir 自己的 `config.json` / `books/` / `relations.json` 全是空壳。后果：① 用户从外部探查目录看到空目录以为 app 没工作；② 配置面板 `configGet` 读不到 data_dir/config.json → fallback DEFAULT → "数据目录"字段显示空字符串。修复：首次 picker 完成后**同步**调 `writeConfig({...DEFAULT, data_dir: picked})` + `ensureDir(PATHS.booksDir(picked))`。`relations.json` 保持懒创建（空 relations 与文件不存在行为一致）

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
- [x] vitest 单测（unlock + progress）

## 十二、未实现 / 后续可加

- [ ] `tags` 字段 UI（后端已支持，前端表单未暴露）
- [ ] 笔记（Markdown）读写（占位字段已写 `## 笔记`，未实现编辑器）
- [ ] 数据导入/导出（JSON / CSV）
- [ ] 备份 / 还原
- [ ] 多用户数据目录切换 UI（已支持切换，但需重启应用）
- [ ] 国际化（目前硬编码中文）
- [ ] `docs/architecture.md`（README 里有占位，待补）

## 十三、测试规范

- 纯函数测试放 `src/shared/__tests__/*.test.ts`，跟被测代码同目录或就近
- 测试用 vitest 的 `describe / it / expect`；不要 jest 的 `test()`
- 跑：`npm test`（CI 模式）或 `npm run test:watch`（开发模式）
- 每次加新的 pure function（不依赖 fs / electron），必须带测试
- 加 IPC handler 时，如果逻辑复杂（不是单纯 dispatch），把核心逻辑抽到 `src/shared/` 测

## 十四、数据目录约定

应用启动时检查 `userData` 层的 `config.json`：

- `data_dir` 存在且目录存在 → 用之
- 不存在 → 弹原生文件夹 picker 让用户选 → 写入 `userData` 层 + **同步**初始化 `data_dir` 自带结构（见第十节第 11 条坑）

**两层 config 的区别**：

- `userData/config.json`（`%APPDATA%\book-tracker\config.json`）→ 只存 `data_dir` 一个字段，是应用启动入口
- `<data_dir>/config.json` → 完整 `Config`（`data_dir` / `language` / `default_mode`），用于设置面板读写和"切换数据目录"逻辑

**用户数据目录结构**：

```
<data_dir>/
├── books/<id>.md          # 每本书一个文件，id 为纯数字
├── relations.json        # 前置关系图（懒创建）
└── config.json           # 用户配置（含 data_dir 自身）
```

**与代码仓分离**：用户数据含个人阅读历史，建议在数据目录单独 `git init` 并推到**另一个** GitHub 仓库，**不要**跟代码混在一起。