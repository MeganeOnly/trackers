# Roadmap

> v1 之后的可选方向。本文件**不承诺时间表**，只是把"下次回来可能想做的事"显式列出来 —— 防止遗忘，也防止临时起意做了一半又停。
> 决策依据看 [`docs/dev-notes.md`](dev-notes.md)（经验沉淀） + [`docs/shared-boundary.md`](shared-boundary.md)（共享判定规则）。

---

## 候选 A：UI 基座抽离（结构型）

**状态**：方案已在 [`docs/shared-boundary.md`](shared-boundary.md)「待办」段写完，可直接执行。

**内容**：把两 app 各复制一份的 `Modal / TopBar / GraphView / GraphModal / PrereqEditor / styles-base` 抽进 `packages/tracker-ui`，两 app 改引 `@ui/*` alias。

**学到**：组件 API 抽象、跨 app 一致性约束、参数化 Props 设计。

**代价**：`GraphView` 跟领域耦合较深（状态颜色 / 力参数 / store 访问 / 候选搜索字段），接口要反复迭代；`PrereqEditor` 涉及 store 写入，参数化需谨慎；工作量约 3–5 天。

**触发**：两 app 有 UI 级改动需求，或视觉一致性出现问题。

---

## 候选 B：book-tracker 拉齐 / 数据导入（领域型）

**状态**：现状 book-tracker 几乎是简版 —— renderer vitest 只继承 core 的 55 条，没有自己专属的领域测试。

**内容**：
- reading session（一次阅读的起止 + 笔记）
- 书单 / 评分
- 豆瓣 / Goodreads 批量导入（解析第三方数据格式）
- 书与书之间的推荐图（基于共同作者 / 共同主题）

**学到**：领域深化、第三方数据格式解析、批量 IO。

**代价**：要保持 book 「下位」定位（"想读的书 + 前置依赖"是核心，加太多反客为主）；导入要兼容豆瓣 / Goodreads 的脏数据。

**触发**：用户主要用 book-tracker 时感到能力不足。

---

## 候选 C：工程效能 / release 流程升级（运维型）

**状态**：现状 `.github/workflows/release.yml` 按 tag 前缀分派构建对应 app；本地 release 仍依赖手工。

**内容**：
- Tauri Updater 接入（应用内"检查更新"按钮）
- 自动 CHANGELOG（基于 conventional commits，从 commit message 生成 release notes）
- 版本管理（手动 bump → 自动 bump）
- 二进制签名（Tauri Updater 必需）

**学到**：release engineering、CI/CD、应用签名。

**代价**：Tauri Updater 需要签名服务器（可用 GitHub Action 自动签名）+ 公钥分发到 app 端；工作量约 1 周。

**触发**：想对外发 release / 想给应用加自动更新。

---

## 候选 D：领域深化（life-tracker）

**状态**：v1 已覆盖 countable / 互斥 / specs / 多次添加；剩余几个常见需求未做。

**内容**：
- deadline（目标有截止日期，逾期高亮）
- 通知（解锁 / 临近 deadline 时桌面通知）
- 模板（goal 模板，可复用结构）
- 子目标层级（A → A1 → A2，目前是平铺）

**学到**：领域建模深化、桌面通知 API、子层级对图算法的挑战。

**代价**：deadline 改动会影响解锁图（逾期是否锁住？）；桌面通知在 Tauri 需要权限；子层级对 `computeUnlocked` 是扩展点。

**触发**：用户开始用 life-tracker 管真实目标时感到缺失。

---

## 候选 E：领域深化（book-tracker）

参见候选 B。

---

## 候选 F：暂停 / 长期搁置

**触发条件**：若一年后仍无动 v2 的意愿，且本文件所有候选都过了一轮评估都被搁置 —— 把 v1 当成 "stable"，归入"维护模式"：

- 不再主动迭代，只修 critical bug
- 把仓库归档（写 `ARCHIVED.md` 说明 + 接手指南）
- 把精力放到别的项目

**不是"放弃"**，是"接受现状是终态"。

---

## 决策记录

- **2026-08 v1 freeze**：上面 A~F 全部待评估，无 commit 承诺。freeze 时点 = 339 测试全绿 + 3 个核心文档（CHANGELOG / ROADMAP / user-guide）落地。