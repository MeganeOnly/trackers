import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { BookForm } from './components/BookForm'
import { GraphModal } from './components/GraphModal'
import { RankingModal } from './components/RankingModal'
import { SeriesModal } from './components/SeriesModal'
import { SettingsPanel } from './components/SettingsPanel'
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

  const [formOpen, setFormOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [rankingOpen, setRankingOpen] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
    setFormOpen(true)
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
      } else if (key === 's') {
        e.preventDefault()
        setSeriesOpen((v) => !v)
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
          onSeries={() => setSeriesOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        <div className="app-body">
          <EditModeWrapper />
        </div>
        {formOpen && <BookForm book={null} onClose={() => setFormOpen(false)} />}
        {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
        {rankingOpen && <RankingModal onClose={() => setRankingOpen(false)} />}
        {seriesOpen && <SeriesModal onClose={() => setSeriesOpen(false)} />}
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      </div>
    </WikilinkProvider>
  )
}

function EditModeWrapper(): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  return mode === 'edit' ? <EditMode /> : <CleanMode />
}
