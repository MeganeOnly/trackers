# BookTracker — 下位书籍追踪器

管理"想读的书 + 前置依赖"，自动算出"现在能读哪本"。

## 功能

- 添加一本书：书名 / 作者 / 国家 / 年份 / 译者
- 给一本书加前置依赖，多对多网状结构
- 解锁规则：严格全部读完 (`all`) 或阈值型 (`any_of` N 本)
- 日常模式：自动列出"现在能读的书"，按反向度数排序（基础书靠前）
- 编辑模式：增删改、状态切换（想看/搁置/在读第N次/已读/弃读）
- 关系图：力导向图，500 节点流畅
- 数据：每本书一个 Markdown 文件 + JSON 关系图，可直接 `git init` 管理

## 技术栈

- Electron 33 + electron-vite + React 18 + TypeScript + Vite
- zustand（状态）
- gray-matter（Markdown frontmatter）
- pinyin-pro（中文 slug）
- react-force-graph-2d（力导向图）
- vitest（单测）

## 开发

\`\`\`bash
npm install
npm run dev         # 启动开发模式（带热重载）
npm run build       # 构建主+preload+renderer
npm run typecheck   # tsc 检查
npm test            # 跑单测
\`\`\`

## 打包

\`\`\`bash
npm run pack        # 本地构建（不打包成 installer）
npm run dist        # 全平台打包
npm run dist:win    # 仅 Windows x64
\`\`\`

产物在 `release/` 目录。

## 数据

应用数据和应用代码**分离**：

- **代码仓库**：`book-tracker/`（这个目录）—— Git 管理
- **用户数据**：用户启动应用时选择的目录（默认首次会让用户选）

用户数据目录结构：

\`\`\`
<data_dir>/
├── books/{slug}.md       # 一本书一个文件
├── relations.json        # 前置关系图
└── config.json
\`\`\`

在数据目录跑 `git init` 即可纳入 Git 管理。建议发 GitHub 时**代码 + 数据分两个仓库**，因为数据含个人阅读历史。

## 书文件格式

\`\`\`markdown
---
id: bai-nian-gu-du
title: 百年孤独
author: 加西亚·马尔克斯
country: 哥伦比亚
year: 1967
translator: 范晔
status: reading
read_count: 2
created: 2024-01-15T...
updated: 2024-03-20T...
tags: []
---

# 百年孤独

## 笔记
...（自由写）

## 摘录
...（自由写）
\`\`\`

## relations.json 格式

\`\`\`json
{
  "version": 1,
  "edges": [
    {
      "to": "bai-nian-gu-du",
      "prerequisites": ["huo-luan-shi-qi-de-ai-qing", "zu-zhang-de-qiu-tian"],
      "rule": "all"
    },
    {
      "to": "some-book",
      "prerequisites": ["a", "b", "c"],
      "rule": "any_of",
      "threshold": 2
    }
  ]
}
\`\`\`

## 状态机

| 状态 | 含义 | 是否满足前置 |
|---|---|---|
| `want` | 想看 | — |
| `shelved` | 搁置 | — |
| `reading` | 在读（第 N 次） | 否 |
| `finished` | 已读 | **是** |
| `abandoned` | 弃读 | 否 |

只有 `finished` 才算"已掌握"。

## 解锁规则

- `all`（默认）：所有前置 `finished` 才解锁
- `any_of`：至少 `threshold` 个前置 `finished` 才解锁
- 无前置：永远解锁

循环依赖会被检测并阻止保存。

## 设计取舍

详见 `docs/architecture.md`（占位，后续补）。
