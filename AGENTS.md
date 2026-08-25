# AGENTS.md — trackers monorepo onboarding

> 给后续 agent 的 monorepo 开发指南。本文件随项目 commit，不含本机路径 / 私人化信息。

## 一、定位

本仓库是**两个 Tauri 2 桌面应用的共享 monorepo**：

- `apps/book-tracker` —— 下位书籍追踪器（想读的书 + 前置依赖 + 解锁）
- `apps/life-tracker` —— 人生目标追踪器（大目标 + 前置依赖 + 解锁，如"国奖 ← 三好 + 两篇 SCI"）

两个应用共享一套"前置依赖图 + 解锁 + 文件存储 + 配置 + 数据目录"内核（`tracker-core`），以及少量 UI 基座（`tracker-ui`）。**共享部分一处改、两 app 同时生效**；领域差异留在各自 app。

## 二、目录结构

```
├── Cargo.toml                    # Cargo workspace（两个 src-tauri + crates/tracker-core）
├── package.json                  # 根脚本（dev:book / dev:life / test:core / test:rust …）
├── .cargo/config.toml            # GNU linker（x86_64-pc-windows-gnu → ucrt64 gcc）
├── .gitattributes                # * text=auto eol=lf
├── AGENTS.md                     # 本文件
├── docs/
│   ├── shared-boundary.md        # ★ 共享边界清单 + 归属判断规则（改代码前先看）
│   └── architecture.md
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
2. 验证：`npm --prefix packages/tracker-core test` + `cargo test -p tracker-core`
3. 一个 commit 提交（core 改动同时惠及两 app，无需跨仓）

领域改动（只动一个 app）：只改对应 `apps/<name>/`，物理上不影响另一个。

## 六、常用命令

```bash
# 根
cargo test                  # workspace 全量 Rust 测试
npm run test:core           # tracker-core TS 测试

# book-tracker
cd apps/book-tracker && npm run dev        # tauri dev（Vite 1420 + Rust）
cd apps/book-tracker && npm run dev:vite   # 纯 renderer
cd apps/book-tracker && npm run typecheck
cd apps/book-tracker && npm test

# life-tracker（Vite 端口 1421）
cd apps/life-tracker && npm run dev
cd apps/life-tracker && npm run dev:vite
cd apps/life-tracker && npm run typecheck
cd apps/life-tracker && npm test
```

## 七、数据与代码分离（不变）

应用数据（`books/`、`goals/`、`relations.json`、`config.json`）由用户启动时选定的数据目录管理，与代码仓完全分离；两 app 各自数据目录独立。

## 八、发布

GitHub release 走 root `.github/workflows/release.yml`，按 tag 前缀分派：
- `book-tracker-v*` → 构建 apps/book-tracker
- `life-tracker-v*` → 构建 apps/life-tracker
