import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { AddModal } from './components/AddModal'
import { GraphModal } from './components/GraphModal'
import { RankingModal } from './components/RankingModal'
import { SettingsPanel } from './components/SettingsPanel'
import { BookNotesModal } from './components/BookNotesModal'
import { WikilinkProvider } from './components/WikilinkContext'
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
        />
        <div className="app-body">
          <EditModeWrapper onOpenNotes={setNotesBookId} />
        </div>
        {addOpen && <AddModal onClose={() => setAddOpen(false)} />}
        {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
        {rankingOpen && <RankingModal onClose={() => setRankingOpen(false)} />}
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        {notesBookId && (
          <BookNotesModal
            bookId={notesBookId}
            onClose={() => setNotesBookId(null)}
          />
        )}
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
