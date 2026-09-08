import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EpisodeNotesStickyApp } from './EpisodeNotesStickyApp'
// 共享 token + reset + 全局排版(由 packages/tracker-ui 提供)
import '@ui/base.css'
// 共享 GraphView 样式(.graph-view / .graph-legend / .lg-*)—— commit 0 重构下沉
import '@ui/GraphView.css'
// 三个 theme preset 全部静态 import —— 运行时由 :root[data-theme] 选 active 哪套,
// 多加载的几个 CSS 体积很小(每个 ~30 行),换来切换零延迟
import '@ui/themes/classic.css'
import '@ui/themes/library.css'
import '@ui/themes/codex.css'
// list / grid / focus-stack 三种 format 的 CSS —— 通过 :root[data-format] 切换
// (list 是 base.css 内置的默认;grid / focus-stack 加各自的样式)
import './styles.css'

// 路由检测(v2.x 简化版,无 react-router):
// - #/sticky → 独立便签窗口(由 Rust 端 `open_sticky_window` 命令创建时设置 URL)
// - 默认 hash → 主 app
// - 路由切换:目前不支持(简化;hash 由创建时决定,运行中不变)
// 选用 hash 而非 path 是因为 Tauri 2 的 WebviewUrl::App 接受 `index.html#/sticky`
// 格式,无需额外的 URL routing 配置
function Root(): JSX.Element {
  if (window.location.hash === '#/sticky') {
    return <EpisodeNotesStickyApp />
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)