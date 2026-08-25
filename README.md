# trackers — 双 tracker 应用的共享 monorepo

两个 Tauri 2 桌面应用共享一套"前置依赖图 + 解锁 + 文件存储 + 配置 + 数据目录"内核：

| 应用 | 目录 | 功能 |
|---|---|---|
| **book-tracker** | `apps/book-tracker` | 下位书籍追踪器（想读的书 + 前置依赖） |
| **life-tracker** | `apps/life-tracker` | 人生目标追踪器（大目标 + 前置依赖，如"国奖 ← 三好 + 两篇 SCI"） |

**共享内核（一处改、两 app 同时生效）**：
- `packages/tracker-core` — TS 纯逻辑：前置依赖图解锁 / 进度 / 通用类型（vitest）
- `crates/tracker-core` — Rust：原子写 / 数字 ID / frontmatter / relations / config / data_dir（cargo test）

领域差异（状态机、字段、表单、卡片、文案）留在各自 app。

## 快速开始

```bash
# Rust 全量测试（workspace）
cargo test

# book-tracker（Vite 1420）
cd apps/book-tracker && npm install && npm run dev

# life-tracker（Vite 1421，与 book 端口区分）
cd apps/life-tracker && npm install && npm run dev
```

## 关键文档

- `AGENTS.md` — monorepo onboarding（依赖方向、core 改动流程、命令表）
- `docs/shared-boundary.md` — ★ 共享边界清单 + 新代码归属判断规则

## 架构速览

```
packages/tracker-core (TS)  ←  renderer（@core/* alias）
crates/tracker-core (Rust)  ←  两个 src-tauri（Cargo path 依赖）
```

- 用户数据（books/、goals/、relations.json、config.json）与代码完全分离，由启动时选择的目录管理
- book-tracker 历史经 git subtree 迁入保留；共享逻辑统一收敛到 `tracker-core`
