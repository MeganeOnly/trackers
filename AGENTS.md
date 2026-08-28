# AGENTS.md — trackers monorepo onboarding

> 给后续 agent 的 monorepo 开发指南。本文件随项目 commit，不含本机路径 / 私人化信息。

## 一、定位

本仓库是**两个 Tauri 2 桌面应用的共享 monorepo**，启用 **npm workspaces**（`apps/*` + `packages/*` 共享根 `node_modules/`）：

- `apps/book-tracker` —— 下位书籍追踪器（想读的书 + 前置依赖 + 解锁）
- `apps/life-tracker` —— 人生目标追踪器（大目标 + 前置依赖 + 解锁，如"国奖 ← 三好 + 两篇 SCI"）

两个应用共享一套"前置依赖图 + 解锁 + 文件存储 + 配置 + 数据目录"内核（`tracker-core`），以及少量 UI 基座（`tracker-ui`）。**共享部分一处改、两 app 同时生效**；领域差异留在各自 app。

**workspaces 约定（避免误区）**：

- **公共 devDependencies 必须上提到根 `package.json`**（`typescript` / `vite` / `vitest` / `@tauri-apps/cli` / `@vitejs/plugin-react` / `@types/*` / `gray-matter`）；各 app 只保留运行时 `dependencies`。
- **从根 `npm install` 一次**即可，所有公共 devDep 自动 hoisted 到 `<repo-root>/node_modules/`；apps/* 与 packages/* 不再各自装一份。
- **从 app 目录跑 `npm run dev` / `vite` / `tsc` / `vitest`** 时，npm 会把根 `node_modules/.bin/` 加到 PATH，所以 `vite` / `tsc` / `vitest` / `tauri` 二进制都能找到，**不需要**显式改 PATH 或用相对路径。
- **不要**在 app 目录跑 `npm install`（会把 node_modules 写到 `apps/<name>/node_modules/`、绕过 hoist、跟根 lockfile 不一致）。
- 单 app 的 `package-lock.json` 已删（2026-08 迁移到 workspaces 时清理）；根 `package-lock.json` 是唯一 source of truth。

## 二、目录结构

```
├── Cargo.toml                    # Cargo workspace（两个 src-tauri + crates/tracker-core）
├── package.json                  # 根脚本（dev:book / dev:life / test:core / test:rust …）
├── .cargo/config.toml            # GNU linker（x86_64-pc-windows-gnu → ucrt64 gcc）
├── .gitattributes                # * text=auto eol=lf
├── AGENTS.md                     # 本文件
├── docs/
│   ├── shared-boundary.md        # ★ 共享边界清单 + 归属判断规则（改代码前先看）
│   ├── dev-notes.md              # ★ 经验沉淀（整改/增添后如有值得记录的经验追加到这里）
│   ├── CHANGELOG.md              # 版本演进（v1 / v1.1 ...）
│   ├── ROADMAP.md                # 后续候选方向（不承诺时间表）
│   └── user-guide.md             # 用户上手指南
├── packages/
│   ├── tracker-core/             # TS 纯逻辑（无 React）：unlock / progress / 通用类型 + vitest
│   └── tracker-ui/               # React 基座：Modal / TopBar / GraphView / PrereqEditor / styles-base
├── crates/
│   └── tracker-core/             # Rust：files / slug / frontmatter / unlock / config / data_dir + cargo test
└── apps/
    ├── book-tracker/             # Book 领域（renderer + src-tauri）
    └── life-tracker/             # Goal 领域（renderer + src-tauri）
```

## 三、依赖方向（单向，禁止反向）

```
packages/tracker-core ← renderer（@core/* alias）
packages/tracker-ui   ← renderer（@ui/* alias）
crates/tracker-core   ← 两个 src-tauri（Cargo path 依赖）

core 不依赖任何 app / Tauri API / React（tracker-ui 依赖 react，不依赖 app）
renderer 永远不能 import src-tauri；Rust 端也不能 import renderer
```

## 四、共享边界（完整清单见 docs/shared-boundary.md）

核心判断规则：**两个 app 都需要且语义一致才进 core；跟领域绑定（如 deadline / 书的作者字段）一律留 app。**

- **进 core**：unlock 图（isDone 谓词参数化）、relations 读写、progress 纯函数、frontmatter 存取、数字 ID、原子写、config 读写、data_dir 双仓流程、Modal/TopBar/GraphView/PrereqEditor、styles-base
- **留 app**：领域类型字段（Book vs Goal）、状态机名称与文案、表单/卡片/列表/详情页、renderer api shim（命令名不同）、领域 CSS

## 五、core 改动流程

1. 改 `packages/tracker-core` 或 `crates/tracker-core`，同步补/改测试（vitest + cargo test）
2. 验证：`npm run test:core` + `cargo test -p tracker-core`（全跑用 `npm run test` + `npm run test:rust`）
3. 一个 commit 提交（core 改动同时惠及两 app，无需跨仓）

领域改动（只动一个 app）：只改对应 `apps/<name>/`，物理上不影响另一个。

## 六、常用命令

```bash
# 安装（workspaces，repo 根跑一次）
npm install                                # 公共 devDep 全部 hoisted 到根 node_modules/

# 根（不 cd 进 app）
npm run dev:book                           # tauri dev book-tracker
npm run dev:life                           # tauri dev life-tracker
npm run dev:vite:book                      # 仅 vite book-tracker
npm run dev:vite:life                      # 仅 vite life-tracker
npm run typecheck                          # 三端 + core 全 typecheck
npm run test                               # core + book + life vitest 全跑
npm run test:core                          # 仅 tracker-core vitest
npm run test:book / test:life              # 单 app vitest
npm run build:book / build:life            # 单 app tauri build
cargo test                                 # Rust workspace 全量测试

# 进 app 目录跑也行（workspaces 找到二进制）
cd apps/book-tracker && npm run dev        # tauri dev（Vite 1420 + Rust）
cd apps/book-tracker && npm run dev:vite   # 纯 renderer
cd apps/book-tracker && npm run typecheck
cd apps/book-tracker && npm test

# life-tracker 同上（Vite 端口 1421）
```

> **Windows 环境坑（cargo）**：跑 `cargo` 命令前确保 msys2 的 `ucrt64/bin` 目录在 PATH（linker 与 dlltool 依赖，位置见 `.cargo/config.toml`）。
> 缺了会报 `ld returned 53` / `dlltool: program not found` —— 编译正常但链接失败，是环境 PATH 问题，不是代码问题。

## 七、数据与代码分离（不变）

应用数据（`books/`、`goals/`、`relations.json`、`config.json`）由用户启动时选定的数据目录管理，与代码仓完全分离；两 app 各自数据目录独立。

## 八、发布

GitHub release 走 root `.github/workflows/release.yml`，按 tag 前缀分派：
- `book-tracker-v*` → 构建 apps/book-tracker
- `life-tracker-v*` → 构建 apps/life-tracker

## 九、经验沉淀（每次整改/增添后）

**每次整改、增添功能后，如有值得沉淀的经验、注意点、踩坑，追加到 `docs/dev-notes.md`**
（新条目放对应主题节开头或按日期倒序）。

要求：

- 只写**中性、可提交**的技术经验：不写本机路径、私人陈述、内部对话原话（与本文档同标准）
- 每条保持最小结构：**现象 → 根因 → 修复 / 规避 → 回归验证**
- 通用教训标 `[共享]`，单 app 的标 app 名；涉及共享内核的改动，记录时同步考虑是否补 core 测试
- 找不到合适主题时，可新开一节（`## YYYY-MM：<主题>`）

本节的目的是让后续 agent 复用已踩过的坑，避免同类 bug 反复出现。
