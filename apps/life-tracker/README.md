# LifeTracker — 人生目标追踪器

> **monorepo 迁移说明**：本项目现位于 `trackers` monorepo（仓库根 `<repo-root>`）的 `apps/life-tracker`。
> 共享逻辑（前置依赖图 / 解锁 / 进度 / 文件存储 / 配置 / 数据目录）已抽到 `tracker-core`
> （`packages/tracker-core` TS + `crates/tracker-core` Rust），与 `book-tracker` 共用——**一处改、两 app 同生效**。
> 本目录 `src/shared/` 只保留 Goal 领域类型与文案（`formatGoalProgress`、`isGoalDone`）；
> 开发命令与工作流见根 `AGENTS.md`。

管理**大目标 + 前置依赖**（多对多网状结构），自动算出"现在能推进哪个目标"。
例子："国奖 ← 三好 + 两篇 SCI"。

## 功能

- 添加一个目标：标题 / 描述 / 分类（如"学业/科研/健康"）/ 截止日期（可选）/ 量化进度（可选）/ 可计数标志
- 状态机：`not_started` / `in_progress` / `done` / `shelved` / `abandoned`
- **可计数目标**（`countable: true`）：没有"全达成"语义（如"发论文"）—— 完成次数独立 section，
  不受 status 限制；同一目标的不同完成次数可独立成 prereq（"B 完成 1 次 AND B 完成 2 次 OR C"）
- **量化进度**（`progress: { current, total }`）：进度满 = 自动达成（`isGoalDone`）
- **截止日期**（`deadline: YYYY-MM-DD`）：逾期高亮（仅 UI，不影响解锁）
- **置顶到『进行中』**（`pinned`）：日常模式顶部『进行中』栏只显示 `pinned=true` 的目标
- **日常模式收起**（`hidden`）：从『现在能推进的目标』列表隐藏（纯展示，不影响解锁）
- **编辑模式侧栏收起**（`collapsed`）：从 status 分组移到侧栏底部『已收起』分组（所有 status 都允许，纯展示）
- **前置依赖**（多对多）：四种 spec 类型 + 二选一组合 + 互斥规则
- **回收站**：删除目标移到 `<data_dir>/.trash/`，可还原 / 永久删除 / 清空
- 关系图：力导向可视化
- **图分析**（`AnalyzeModal`）：健康度评分 + 孤立节点 / 瓶颈节点 / 阻塞路径
- 设置面板：主题（classic / library / codex）+ 格式（list / grid / focus-stack）
- 数据：每个目标一个 Markdown 文件 + JSON 关系图，可直接 `git init` 管理

## 前置规格化（specs）

代替旧的"全部必须完成 / 阈值 / 二选一组"，specs 统一表达四种语义：

| spec 类型 | 例子 | 含义 |
|---|---|---|
| **simple** | `A 完成` | A 处于完成状态 |
| **count** | `A 完成 3 次` | A 完成次数 ≥ 3 |
| **group** | `group(B, C) 中至少 1 个完成` | B、C 中至少一个完成（支持 per-member count） |
| **exclude** | `⊘ D 完成` | D 完成时本目标被排除（`disqualifies`） / 必须完成才能解锁（`satisfies`） |

可组合：`(B 完成 1 次) AND ((B 完成 2 次) OR C 完成)` —— "先把 B 完成 1 次，再完成 B 第 2 次**或**完成 C"。

## 技术栈

- Tauri 2（Rust 后端 + 系统 WebView 渲染）
- React 18 + TypeScript + Vite 5
- zustand（状态）
- react-force-graph-2d（力导向图）
- vitest（renderer/shared 单测）+ cargo test（Rust 后端测试）

## 开发

```bash
npm install         # 在仓库根跑（workspaces 公共 devDep 全部 hoisted）
npm run dev         # tauri dev：启动 Vite + 编译 Rust + 打开原生窗口（带热重载）
npm run dev:vite    # 只跑 Vite dev server (1421)，纯 renderer 调试用
npm run typecheck   # tsc 双段检查（node: vite.config.ts；web: renderer + shared + @core）
npm test            # vitest run（tracker-core 共享纯函数 + 本 app 领域测试）
```

Vite 端口固定 **1421**（与 book-tracker 的 1420 区分）。`tauri.conf.json` 的 `devUrl` +
`vite.config.ts` 的 `server.port` 必须保持一致，否则 tauri dev 起不来。

## 打包

```bash
npm run build        # tauri build：产物在 src-tauri/target/release/bundle/nsis/*.exe
npm run build:vite   # 只跑 vite build：产物在 dist/（供 tauri build 消费）
```

Rust 后端验证（monorepo workspace 统一在根跑）：

```bash
cd <repo-root> && cargo test                    # workspace 全量（含本 app）
cd <repo-root> && cargo build -p life-tracker   # 单 app 构建
```

## 发布

推送形如 `life-tracker-v0.1.0` 的 tag 触发 monorepo 根 `.github/workflows/release.yml`
（按 tag 前缀分派本 app），自动构建 Windows NSIS installer 并创建 draft GitHub Release：

```bash
git tag life-tracker-v0.1.0
git push origin life-tracker-v0.1.0
# → GitHub Actions 跑完后到 repo 的 Releases 页 review draft 并 publish
# （book-tracker 用 book-tracker-v* 前缀，同一 workflow 分派）
```

工作流特性：

- **Windows 单矩阵** + MSVC 工具链（local dev 用 GNU 需自配 PATH，CI 用 MSVC 是 Tauri 官方推荐组合）
- 使用 [`tauri-apps/tauri-action@v0`](https://github.com/tauri-apps/tauri-action) 一站式处理 Rust / webview2 / 构建 / 上传
- 默认 draft，需要手动 review 后再 publish，避免误发

## 数据

应用数据和应用代码**分离**：

- **代码仓库**：`life-tracker/`（这个目录）—— Git 管理
- **用户数据**：用户启动应用时选择的目录（默认首次会让用户选）

用户数据目录结构：

```
<data_dir>/
├── goals/<id>.md       # 一个目标一个文件，id 为纯数字
├── relations.json      # 前置关系图
├── .trash/             # 回收站（删除的目标移到此处，可还原）
└── config.json
```

在数据目录跑 `git init` 即可纳入 Git 管理。建议发 GitHub 时**代码 + 数据分两个仓库**，
因为数据含个人目标进度。

## 目标文件格式

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
  "countable": false,
  "pinned": true,
  "hidden": false,
  "collapsed": false,
  "created": "2026-01-15T...",
  "updated": "2026-03-20T..."
}
---

# 国奖

## 备注
...（自由写）
```

`countable` / `pinned` / `hidden` / `collapsed` 仅在 `true` 时写盘，缺省 `false`；
老文件缺字段 → `false`（向后兼容）。

`deadline` / `progress` 只在有值时写盘；`progress` 写盘判断与 book-tracker 同款（避免污染）。

## relations.json 格式

```json
{
  "version": 1,
  "edges": [
    {
      "to": "1",
      "prerequisites": ["2", "3"],
      "specs": [
        { "kind": "simple", "id": "2" },
        { "kind": "group", "members": [{ "id": "3" }], "pick": 1 },
        { "kind": "exclude", "trigger": "4", "target": "1", "effect": "disqualifies" }
      ]
    }
  ]
}
```

`specs` 优先于 `rule` / `threshold` / `groups`（旧数据自动升级到 specs）。

## 状态机

| 状态 | 含义 | 算"已达成"吗 |
|---|---|---|
| `not_started` | 未开始 | — |
| `in_progress` | 进行中 | 仅当量化进度已满 |
| `done` | 已达成 | **是** |
| `shelved` | 搁置 | 否 |
| `abandoned` | 放弃 | 否 |

只有 `done`（或进度已满的 `in_progress`）才算"已达成"，才会让前置它的目标解锁。
countable 任务没有"已达成"语义——它永远 `in_progress`，解锁判定按引用方要求的次数算。

## 解锁规则

- `all`（默认）：所有前置达成才解锁
- `any_of`：至少 `threshold` 个前置达成才解锁
- `specs`：四种 spec 类型（simple / count / group / exclude）组合 + per-member count
- 互斥规则（`ExcludeSpec`）：disqualifies / satisfies 改写 done 谓词
- 无前置：永远解锁

循环依赖会被检测并阻止保存。

## 设计取舍

详见 `docs/shared-boundary.md`（共享边界判定）和 `docs/dev-notes.md`（经验沉淀）。
