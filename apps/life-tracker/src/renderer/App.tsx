import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { GoalForm } from './components/GoalForm'
import { GraphModal } from './components/GraphModal'
import { TrashModal } from './components/TrashModal'
import { useModeStore } from './store/mode'
import { useGoalsStore } from './store/goals'
import { useRelationsStore } from './store/relations'
import { useSearchStore } from './store/search'
import { api } from './lib/api'

export default function App(): JSX.Element {
  const loadGoals = useGoalsStore((s) => s.load)
  const loadRelations = useRelationsStore((s) => s.load)
  const select = useGoalsStore((s) => s.select)
  const clearSearch = useSearchStore((s) => s.clear)

  const [formOpen, setFormOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

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
        await Promise.all([loadGoals(), loadRelations()])
      } catch (e) {
        console.error('init load failed:', e)
      }
    })().catch((e) => console.error('init flow failed:', e))
    return () => {
      cancelled = true
    }
  }, [loadGoals, loadRelations])

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
  }, [loadGoals])

  return (
    <div className="app-shell">
      <TopBar onAdd={openAdd} onGraph={() => setGraphOpen(true)} onTrash={() => setTrashOpen(true)} />
      <div className="app-body">
        <EditModeWrapper />
      </div>
      {formOpen && <GoalForm goal={null} onClose={() => setFormOpen(false)} />}
      {graphOpen && <GraphModal onClose={() => setGraphOpen(false)} />}
      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
    </div>
  )
}

function EditModeWrapper(): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  return mode === 'edit' ? <EditMode /> : <CleanMode />
}
