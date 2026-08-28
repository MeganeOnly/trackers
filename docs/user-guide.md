# 用户上手指南

> 面向两个 tracker 应用的最终用户。
> 面向开发者的 onboarding 见 [`AGENTS.md`](../AGENTS.md) + [`docs/shared-boundary.md`](shared-boundary.md)。

---

## 共同基础

### 安装与启动

两个应用都是 **Tauri 2 桌面应用**：
- `book-tracker`（Vite 1420）
- `life-tracker`（Vite 1421，端口与 book 区分以避免冲突）

启动后**首先选择数据目录**（"应用数据"对话框）。这个目录会被持久化在 `config.json`，后续启动不再询问。备份 / 同步时复制整个数据目录即可。

### 数据目录结构

```
<数据目录>/
├── books/                    # book-tracker：每本书一个 markdown 文件
│   └── <id>.md               # frontmatter: id, title, author, country, year, ...
├── goals/                    # life-tracker：每个目标一个 markdown 文件
│   └── <id>.md               # frontmatter: id, name, category, status, progress, ...
├── relations.json            # 两 app 各自维护：边关系（前置依赖图）
└── config.json               # 应用配置（数据目录路径、视图偏好等）
```

数据与代码完全分离。可以随时换目录（手动编辑 `config.json` 或启动时重选），不影响代码版本。

---

## book-tracker

### 核心循环

1. **添加想读的书**：标题 / 作者 / 国别 / 年份 / 译者
2. **建立前置依赖**："读 A 之前应先读 B"
3. **标记读完**：解锁依赖它的书
4. **关系图**：直观看到依赖网络

### 视图

- **列表**：所有书按状态分组（想读 / 在读 / 已读 / 弃读）
- **关系图**：节点 = 书，边 = 前置关系
- **前置编辑器**：在书的详情页打开，添加 / 删除前置

---

## life-tracker

### 三类目标

| 类型 | 适用 | 关键字段 |
|---|---|---|
| **普通目标** | 一次性完成（"学完线性代数"） | 状态（todo / in_progress / done / shelved） + 量化进度（current/total） |
| **countable 目标** | 没有"全达成"语义（"发论文"） | 完成次数 current（独立 section，不受 status 限制） |
| **可计数前置** | 同一任务需完成 N 次才能解锁下游 | 引用次数（count 字段） |

### 前置规格化（specs）

代替旧的"全部必须完成 / 阈值 / 二选一组"，specs 统一表达四种语义：

| spec 类型 | 例子 | 含义 |
|---|---|---|
| **simple** | `A 完成` | A 处于完成状态 |
| **count** | `A 完成 3 次` | A 完成次数 ≥ 3 |
| **group** | `group(B, C) 中至少 1 个完成` | B、C 中至少一个完成 |
| **exclude** | `⊘ D 完成` | D 完成时本目标被排除（disqualifies）/ 必须完成才能解锁（satisfies） |

可以组合：`(B 完成 1 次) AND ((B 完成 2 次) OR C 完成)` —— 这意味着"先把 B 完成 1 次，再完成 B 第 2 次**或**完成 C"。

### countable 任务在图里的特殊性

- 一个 countable 目标可以**多次**被添加为前置（每次不同 count）—— picker 上有"已添加 ×N"虚线徽标提示。
- 关系图按 `(source, target)` 去重画边，多个 spec 只画一条；解锁层按 specs 全集逐条判定。
- 节点的"完成次数"section 始终可见，即使 status 已是 done / shelved（与普通目标的量化进度互斥）。

### 视图

- **列表**：按类别分组
- **关系图**：节点 = 目标，边 = 前置关系（计数 / 互斥有视觉区分）
- **目标详情**：编辑字段、量化进度、添加 / 删除前置
- **前置编辑器**：在目标详情页打开，可视化编辑 specs

### 解锁语义

`computeUnlocked(goals, edges, isDone)` 是核心：
- 遍历所有 edges，每条边的 `to` 节点按 specs / excludes 改写后的 `isDone` 谓词判定是否解锁。
- 谓词形参是 `(id, count) => boolean`：渲染层 / 应用层共用同一份（不要自己拼 `isGoalDone`）。

---

## 数据兼容性

- `relations.json` 的旧 `rule+threshold+groups` 形态自动升级为 specs，无需手工迁移。
- `GroupSpec.members: ['a','b']` 与 `[{id: 'a', count: 2}]` 双向兼容。
- relations 不变量校验（v1 启用）会告警"同一个 to 出现多条边"——这种情况会让 `computeUnlocked` 静默丢前置，遇到时根据告警修复 relations.json。

---

## 故障排查

| 现象 | 可能原因 | 处置 |
|---|---|---|
| 添加 / 删除前置"点了没反应" | relations 中存在循环依赖 | 编辑其他边打破环，或按告警修复 |
| 目标"突然解锁色变了" | 互斥规则（exclude）被满足 / 触发 | 检查目标的 excludes 列表 |
| countable 目标进度清零 | （v1 已修）非 v1 数据残留的旧 save 逻辑 | 升级到 v1 后正常 |
| 关系图节点挤成团 | 旧版未做平行边去重 | 升级到 v1 |

---

## 反馈

仓库 issue 或 PR：见根 `README.md` 顶部链接。