import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// 共享 token + reset + 全局排版(由 packages/tracker-ui 提供)
import '@ui/base.css'
// 三个 theme preset 全部静态 import —— 运行时由 :root[data-theme] 选 active 哪套,
// 多加载的几个 CSS 体积很小(每个 ~30 行),换来切换零延迟
import '@ui/themes/classic.css'
import '@ui/themes/library.css'
import '@ui/themes/codex.css'
// list / grid / focus-stack 三种 format 的 CSS —— 通过 :root[data-format] 切换
// (list 是 base.css 内置的默认;grid / focus-stack 加各自的样式)
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
