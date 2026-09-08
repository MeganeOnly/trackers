import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { AddModal } from './components/AddModal'
import { GraphModal } from './components/GraphModal'
import { RankingModal } from './components/RankingModal'
import { SettingsPanel } from './components/SettingsPanel'
import { CandidatesModal } from './components/CandidatesModal'
import { BookNotesModal } from './components/BookNotesModal'
import { WikilinkProvider } from './components/WikilinkContext'
import { listen } from '@tauri-apps/api/event'
import { useModeStore } from './store/mode'
import { useBooksStore } from './store/books'
import { useRelationsStore } from './store/relations'
import { useSeriesStore } from './store/series'
import { useSearchStore } from './store/search'
import { useSettingsStore } from './store/settings'
import { api } from './lib/api'

export default function App(): JSX.Element {
  const loadBooks = useBooksStore((s) => s.load)
  const loadRelations = useRelationsStore((s) => s.load)
  const loadSeries = useSeriesStore((s) => s.load)
  const select = useBooksStore((s) => s.select)
  const clearSearch = useSearchStore((s) => s.clear)
  const hydrateSettings = useSettingsStore((s) => s.hydrate)

  const [addOpen, setAddOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [rankingOpen, setRankingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // v2.x:候选剧集独立 modal(原嵌在 SettingsPanel 左栏,现拆出)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  // v2.x:日常模式点击作品 → 打开作品笔记 Modal(主笔记 + 集笔记 + 角色笔记)
  // 而非切到编辑模式;由 CleanMode 通过 onOpenNotes prop 回调写入
  const [notesBookId, setNotesBookId] = useState<string | null>(null)

  useEffect(() => {
    // 首启流程:ensureDataDir → 若失败弹 picker → 选完再 load。
    // 用户取消 picker 则不 load(留给后续 UI 提示重试)。
    let cancelled = false
    ;(async () => {
      try {
        await api.app.ensureDataDir()
      } catch {
        const picked = await api.data.pickDir()
        if (!picked) {
          console.warn('data dir picker cancelled; app is not initialized')
          return
        }
      }
      if (cancelled) return
      try {
        const cfg = await api.config.get()
        useModeStore.getState().hydrate(cfg)
        hydrateSettings(cfg)
        await Promise.all([loadBooks(), loadRelations(), loadSeries()])
      } catch (e) {
        console.error('init load failed:', e)
      }
    })().catch((e) => console.error('init flow failed:', e))
    return () => {
      cancelled = true
    }
  }, [loadBooks, loadRelations, loadSeries, hydrateSettings])

  // v2.x:监听 sticky 窗口的 'book-changed' 事件 —— sticky 窗口修改某本书的
  // stamps/note 后 emit,主 app 收到后调 loadBooks() 重新拉一次全量数据
  // (books 数量通常几十~几百,全量刷新成本可接受;比单本 update 简单稳定)。
  // 没有这个 listener,sticky 窗口的改动只在它自己的 zustand 里生效,
  // 主 app 的 EpisodesPanel / BookNotesModal / BookDetail 都看不到。
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    ;(async () => {
      try {
        const u = await listen<{ bookId: string }>('book-changed', () => {
          // 走 load 而非单本 update:全量 reload 从 disk 拿最新,避免漏更新
          // 其他跨窗口的副作用(relations 重建、series 引用清理等)
          void loadBooks()
        })
        if (cancelled) {
          u()
          return
        }
        unlisten = u
      } catch (e) {
        // listen 在非 Tauri 环境下会失败(jsdom 测试);吞掉,不影响主流程
        console.warn('listen book-changed failed:', e)
      }
    })()
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [loadBooks])

  function openAdd(): void {
    select(null)
    setAddOpen(true)
  }

  // 全局快捷键（input/textarea 焦点时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        openAdd()
      } else if (key === 'g') {
        e.preventDefault()
        setGraphOpen((v) => !v)
      } else if (key === 'r') {
        e.preventDefault()
        setRankingOpen((v) => !v)
      } else if (key === 'e') {
        e.preventDefault()
        useModeStore.getState().setMode('edit')
      } else if (key === 'c') {
        e.preventDefault()
        useModeStore.getState().setMode('clean')
      } else if (e.key === 'Escape') {
        clearSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadBooks])

  return (
    <WikilinkProvider>
      <div className="app-shell">
        <TopBar
          onAdd={openAdd}
          onGraph={() => setGraphOpen(true)}
          onRanking={() => setRankingOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onCandidates={() => setCandidatesOpen(true)}
        />
        <div className="app-body">
          <EditModeWrapper onOpenNotes={setNotesBookId} />
        </div>
        {addOpen && <AddModal onClose={() => setAddOpen(false)} />}
        {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
        {rankingOpen && <RankingModal onClose={() => setRankingOpen(false)} />}
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        {candidatesOpen && <CandidatesModal onClose={() => setCandidatesOpen(false)} />}
        {notesBookId && (
          <BookNotesModal
            bookId={notesBookId}
            onClose={() => setNotesBookId(null)}
          />
        )}
        {/* v2.x:集笔记便签现在是一个独立的 Tauri 窗口(label='sticky'),
            由面板内 黄色小圆点(EpisodesPanel / BookStampsPanel)触发
            `api.app.openStickyWindow()` 创建 / 聚焦。
            主 app 不再内嵌浮层 —— 用户明确要求"独立窗口"。 */}
      </div>
    </WikilinkProvider>
  )
}

interface EditModeWrapperProps {
  /** v2.x:CleanMode 点击作品 → 打开笔记 modal(取代旧版「切到编辑模式 + 选中」) */
  onOpenNotes: (id: string) => void
}

function EditModeWrapper({ onOpenNotes }: EditModeWrapperProps): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  return mode === 'edit' ? <EditMode /> : <CleanMode onOpenNotes={onOpenNotes} />
}
