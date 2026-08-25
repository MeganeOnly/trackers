# AGENTS.md — life-tracker 项目 onboarding

> **给后续 agent 看的开发指南**。本文件随项目 commit；不含本机路径 / 私人化信息。

## 一、定位

**life-tracker** 是一个本地人生目标追踪器（Tauri 2 桌面应用），管理：

- **大目标** + **前置依赖**（多对多网状结构，自动算"现在能推进哪个目标"，如"国奖 ← 三好 + 两篇 SCI"）
- **状态**：`not_started` / `in_progress` / `done` / `shelved` / `abandoned`
- **量化进度**：如"2 篇 SCI 已完成 1 篇"（`progress: { current, total }`，进度满 = 自动达成）
- **截止日期**：`deadline`（逾期提示）
- **关系图**：力导向可视化

**达成判定**（解锁前置的唯一标准，见 `src/shared/types.ts` 的 `isGoalDone`）：
`status === 'done'`，或 `progress.current >= progress.total`。

**不是**一个云同步、社交、推荐类应用。**纯本地**，用户数据和应用代码完全分离。

## 二、与 monorepo 的关系（重要）

本应用并入 `trackers` monorepo（仓库根 `F:\LIFE`）。**共享逻辑在 monorepo 内核，不要在本目录重新实现/复制**：

- 解锁图 + 环检测：`tracker-core`（TS `packages/tracker-core/src/unlock.ts`、Rust `crates/tracker-core/src/unlock.rs`）—— 以 done map / `isDone` 谓词参数化
- 进度纯函数：`packages/tracker-core/src/progress.ts` / `crates/tracker-core/src/progress.rs`
- 原子写 / JSON / 数字 ID / frontmatter / config / data_dir：`crates/tracker-core`
- 本目录 `src/shared/` 只保留 Goal 领域类型与文案（`formatGoalProgress`、`isGoalDone`）
- **改共享逻辑去 monorepo 根**，改完一个 commit 两 app 同生效（根 `AGENTS.md` §五 + `docs/shared-boundary.md`）

## 三、目录结构

```
src/
├── renderer/
│   ├── App.tsx / main.tsx / styles.css / index.html
│   ├── components/   # TopBar / Modal / GraphView / GraphModal / PrereqEditor（基座）
│   │                 # GoalList / GoalDetail / GoalForm / GoalCard / GoalCardContainer（领域）
│   ├── pages/        # EditMode（列表+详情）/ CleanMode（"现在能推进的目标"）
│   ├── store/        # goals.ts / relations.ts / mode.ts / search.ts / selectors.ts
│   └── lib/api.ts    # Tauri invoke shim（goals_* 命令）
├── shared/           # Goal 领域类型（types.ts）+ 文案（progress.ts）+ API 形状（api.ts）
└── src-tauri/        # Rust：types.rs（Goal serde）+ data/goals.rs + data/config.rs
                      # service/{goals,relations,config,data_dir}.rs + commands.rs（goals_*）
```

依赖方向与 book-tracker 一致（见根 AGENTS.md）。**renderer 只能 import `@core` / `@shared`，禁止 import `src-tauri/`。**

## 四、领域模型

`Goal`（每个目标一个 `<id>.md`，frontmatter JSON）：

```markdown
---
{
  "id": 1,
  "title": "国奖",
  "note": "前置：三好 + 两篇 SCI",
  "category": "学业",
  "deadline": "2027-06-30",
  "status": "in_progress",
  "progress": { "current": 1, "total": 2 },
  "created": "...",
  "updated": "..."
}
---

# 国奖

## 备注
```

- `deadline` / `progress` 只在有值时写盘；`progress` 写盘判断与 book-tracker 同款（避免污染）
- `pinned`（置顶到『进行中』栏）只在 `true` 时写盘，缺省 `false`；旧文件无该字段按 `false` 处理
- `hidden`（日常模式『现在能推进』中收起）同样只在 `true` 时写盘、缺省 `false`；纯展示层不影响解锁，仅对 `not_started` / `in_progress` 有展示意义（隐藏目标进『已收起』折叠栏，状态切到 done/shelved/abandoned 时自动回归各自状态栏）
- `progress.current >= progress.total` → 视为已达成（`isGoalDone`）
- 数据目录：`<data_dir>/goals/` + `relations.json` + `config.json`（%APPDATA%/life-tracker 存 data_dir 指针）

## 五、状态机与解锁

| 状态 | 含义 | 算"已达成"吗 |
|---|---|---|
| `not_started` | 未开始 | — |
| `in_progress` | 进行中 | 仅当量化进度已满 |
| `done` | 已达成 | **是** |
| `shelved` | 搁置 | 否 |
| `abandoned` | 放弃 | 否 |

解锁规则 `all` / `any_of` + threshold + 环检测，全部走 `tracker-core`。

## 六、常用命令

```bash
cd F:\LIFE\apps\life-tracker
npm run dev            # tauri dev（Vite 1421 + Rust）
npm run dev:vite       # 纯 renderer（端口 1421，与 book-tracker 的 1420 区分）
npm run typecheck      # tsc 双段
npm test               # vitest（tracker-core 共享测试）

# Rust 在 repo 根 workspace 统一：
cd F:\LIFE && cargo test -p life-tracker
cd F:\LIFE && cargo build -p life-tracker
```

## 七、加新目标领域功能（本地流程）

1. `src/shared/types.ts` 加字段 → `src-tauri/src/types.rs` 同步 serde 镜像
2. `src/shared/api.ts` + `src/renderer/lib/api.ts` 加 API
3. `src-tauri/src/data/goals.rs` 持久化 → `service/goals.rs` → `commands.rs`（`goals_*`）→ `lib.rs` invoke_handler
4. renderer store / 组件 / 页面接 UI
5. 若新增的是**两个 app 都要的通用逻辑**（解锁规则 / 进度 / 文件存储），去 monorepo 根改 `tracker-core` 并加测试

## 八、踩过的坑（life 特有）

- `deadline` 清空语义：表单发空字符串，Rust `Some("")` → `None`（见 `data/goals.rs` 的 update_goal）
- `GoalPatch.deadline` 是 `Option<String>`（不是三态）——清空靠空字符串约定
- 达成判定要同时看 `status == done` 和"量化进度已满"，两处（TS `isGoalDone` 与 Rust `service/relations.rs`）必须保持一致
- Vite 端口是 **1421**，改回 1420 会和 book-tracker 撞（tauri.conf.json devUrl + vite.config.ts 要一起改）
- CleanMode 顶部『进行中』栏只显示 `status === 'in_progress' && pinned` 的目标。历史上这里用 `goals.find()` 只取**数组第一个** in_progress（单槽位"当前焦点"，沿袭 book-tracker 的"正在读"）——多个 in_progress 时只有第一个显示，容易被当成 bug；改多槽位时必须保留 pinned 过滤，别退回 find
- 给 Goal 加字段要同步 Rust 四处 + TS 一处：`types.rs`（Goal / GoalInput / GoalPatch 三处 serde 镜像）→ `data/goals.rs`（normalize_goal 读取、write_goal、update_goal、persist 写入）；TS 端 `GoalInput = Omit<Goal, ...>` 派生，新必填字段会让 create 调用处立刻报错，属正常提醒
