# 书架追踪

下位书籍追踪器 —— 管理"想读的书 + 前置依赖"，自动算出"现在能读哪本"。

## 技术栈

- Electron + electron-vite + React 18 + TypeScript + Vite

## 开发

```bash
npm install
npm run dev      # 启动开发模式（带热重载）
npm run build    # 构建生产包
npm run preview  # 预览构建结果
npm run typecheck
```

## 数据

数据存放在用户选择的目录里（首次启动会询问），不在本仓库内。结构：

```
<data_dir>/
├── books/{slug}.md       # 一本一文件，frontmatter 存元数据
├── relations.json        # 前置关系图
└── config.json
```

详见后续 `docs/` 补充。
