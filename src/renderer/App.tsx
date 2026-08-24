import { useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { useModeStore } from './store/mode'

function App(): JSX.Element {
  const mode = useModeStore((s) => s.mode)

  useEffect(() => {
    window.electron.config
      .get()
      .then((cfg) => useModeStore.getState().hydrate(cfg))
      .catch((e) => console.error('config load failed:', e))
  }, [])

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">{mode === 'edit' ? <EditMode /> : <CleanMode />}</div>
    </div>
  )
}

export default App
