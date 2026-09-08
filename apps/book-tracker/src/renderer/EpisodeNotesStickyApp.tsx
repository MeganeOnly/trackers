// 集笔记便签 —— 独立窗口的 React 根(v2.x 新增)
//
// 在 Tauri sticky 窗口(URL = `index.html#/sticky`)中作为唯一应用渲染:
// - WikilinkProvider(让 StampList 的 textarea [[ 触发能工作)
// - hydrate store(从 localStorage 恢复 selection)
// - 加载 books 列表(StampList 需要 book + allBooks;主 app 也会加载,
//   但每个 webview 独立;不在主 app hydrate 后通过事件推过来 —— 各自独立加载就行)
//
// 边界:
// - 极简包装,只有 root div + WikilinkProvider + EpisodeNotesSticky
// - 不引入 TopBar / App.tsx / 其他任何主 app 组件(避免把整个 SPA bundle 加载到独立窗口)

import { useEffect, useState } from 'react'
import { WikilinkProvider } from './components/WikilinkContext'
import { EpisodeNotesSticky } from './components/EpisodeNotesSticky'
import { useBooksStore } from './store/books'
import { useEpisodeStickyStore } from './store/episodeSticky'
import { api } from './lib/api'

export function EpisodeNotesStickyApp(): JSX.Element {
  const loadBooks = useBooksStore((s) => s.load)
  const hydrateSticky = useEpisodeStickyStore((s) => s.hydrate)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    // 首启流程:ensureDataDir → loadBooks → hydrate sticky store
    // (跟主 app 的初始化同款,见 App.tsx)
    let cancelled = false
    ;(async () => {
      try {
        await api.app.ensureDataDir()
      } catch {
        // 主 app 已经处理过 data_dir picker,这里失败说明还没选 → 提示用户回主 app
        if (!cancelled) setInitError('请先在主 app 选择数据目录')
        return
      }
      if (cancelled) return
      try {
        await loadBooks()
        hydrateSticky()
      } catch (e) {
        console.error('sticky app init load failed:', e)
        if (!cancelled) setInitError('加载失败,请重试')
      }
    })().catch((e) => console.error('sticky init flow failed:', e))
    return () => {
      cancelled = true
    }
  }, [loadBooks, hydrateSticky])

  if (initError) {
    return (
      <div className="sticky-init-error">
        <p>{initError}</p>
      </div>
    )
  }

  return (
    <WikilinkProvider>
      <EpisodeNotesSticky />
    </WikilinkProvider>
  )
}