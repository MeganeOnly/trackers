# Changelog

> 双 tracker 应用共享内核的版本演进记录。每个 tag / 里程碑单独成段。
> 详细的"现象 → 根因 → 修复 → 教训"经验沉淀见 [`docs/dev-notes.md`](dev-notes.md)。

---

## v1（2026-08）

**首个稳定版本**。这个月从 book-tracker 单体抽出共享内核，长出 life-tracker，并迭代出四类核心能力 + GraphView 工程化 + 共享边界判定 + 经验沉淀体系。

### 核心能力

- **countable 任务**：`SimpleSpec.count` + `Goal.countable` + `isDone` 谓词参数化。可计数任务（如"发论文"）独立"完成次数"section，不受 status 限制；同一任务的不同完成次数可独立成 prereq（"B 完成 1 次 AND B 完成 2 次 OR C"）。
- **互斥规则**（`ExcludeSpec`）：disqualifies / satisfies 两类 effect。改写 done 谓词，让 target 节点在满足/不满足时呈现不同解锁色。
- **前置规格化**（`PrereqSpec`）：替换旧的 `rule+threshold+groups`，支持四类 spec —— simple（A 完成）、group（N 选 K）、count（A 完成 N 次）、exclude（互斥）。旧形态完全兼容。
- **GroupMember per-member count**（v3）：group 内不同 member 可带不同引用次数（`{id, count}`），与 `SimpleSpec.count` 对齐。

### GraphView 工程化

- **悬空 link 过滤**：`react-force-graph` 的 d3-force-link 在 link.source/target 找不到节点时抛 `Error: node not found`。两 app GraphView 都加 `validIds` 过滤，与 `computeUnlocked` 同步。
- **持续运动**：d3-force 的 charge/link/center 三种保守力平衡后净力为零，不会持续动。引入 `orbitForce`（恒定切向速度）+ 强斥力 + 交互感知 freeze，节点既持续流动又可拖动。
- **平行边去重**：countable 多 spec 致同 source→target 画 N 条平行边，把节点挤成团。`deriveLinks` 后置 `(source, target)` 去重，与解锁层解耦。
- **高亮钉中心 + drag-end 回中心**：`onNodeDragEnd` 重置 `fx/fy=0`，让"钉住"不变成"粘死"。

### 工程化

- **npm workspaces 迁移**：根 `package.json` 加 `"workspaces"`，4 个 node_modules 从 410 MB 砍到 140 MB（-66%），`npm install` 60s → <5s 增量。公共 devDeps（typescript / vite / vitest / @tauri-apps/cli / @types/* / gray-matter）上提到根，子目录不再各自装一份。
- **死代码清理**：删未引用的 store/selectors / Rust pass-through 包装 / book-tracker 假笔记 UI。
- **共享边界判定**：[`docs/shared-boundary.md`](shared-boundary.md) 维护三类清单（全共享 / 参数化共享 / 领域专属）+ v1~v3.1 变更记录 + 「待办」段。
- **经验沉淀体系**：[`docs/dev-notes.md`](dev-notes.md) 9 主题 25+ 条，每条"现象→根因→修复→教训"四段 + `[共享]`/`[单 app]` 标签。

### 稳定性

- **前置编辑环检测与后端对齐**：修「点了没反应」静默失败 —— renderer 检测任意环阻止写盘，与 Rust `set_relations` 行为一致。
- **PrereqEditor 删除 / persist 兜底**：specs 为空时不再让 `baseEdge.prerequisites` 兜底逻辑把删除的 id 写回；清除 / 删除操作互不误伤；旧裸 id → 新 specs 走并集保留。
- **relations 不变量校验**（v3.1）：新增 `validate` 模块（Rust + TS 1:1），check 同一个 `to` 只能有一条前置边 —— `compute_unlocked` 的 `to→Edge` 索引隐式依赖此不变量，破坏时静默丢前置。当前只告警不拒绝，避免历史数据一旦不合规就完全写不进去；收紧成硬拒绝只需把 app 层 `set_relations` 的告警改成 validate 闭包返回 `Some(msg)`。

### 测试 & 文档

- **测试**：228 vitest（55 core + 55 book + 118 life）+ 111 cargo test（80 tracker-core + 18 book + 13 life）= **339 个测试全绿**。
- **文档**：
  - `AGENTS.md`（monorepo onboarding）
  - `docs/shared-boundary.md`（共享边界 + 「待办」段）
  - `docs/dev-notes.md`（经验沉淀）
  - `docs/CHANGELOG.md`（本文件）
  - `docs/ROADMAP.md`（v2 候选方向）
  - `docs/user-guide.md`（用户上手指南）

### 数据兼容性

- relations.json 的旧 `rule+threshold+groups` 形态自动升级为 specs。
- `GroupSpec.members: string[]` 与 `[{id, count}]` 双向兼容。
- SimpleSpec 同 id 多次添加（不同 count 视为独立实例）。

### 标签

- `book-tracker-v1`
- `life-tracker-v1`

两 tag 同 commit hash（同 v1 节点），按 `.github/workflows/release.yml` 约定分派构建对应 app。