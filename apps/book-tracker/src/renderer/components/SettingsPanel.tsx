import { Modal } from './Modal'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { WorkKind } from '@shared/types'

interface SettingsPanelProps {
  onClose: () => void
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部作品' },
  ...WORK_KIND_ORDER.map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))
]

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const defaultWorkKind = useSettingsStore((s) => s.defaultWorkKind)
  const setDefaultWorkKind = useSettingsStore((s) => s.setDefaultWorkKind)
  const worksFilter = useSettingsStore((s) => s.worksFilter)
  const setWorksFilter = useSettingsStore((s) => s.setWorksFilter)

  return (
    <Modal title="设置" onClose={onClose} width={460}>
      <div className="settings-panel">
        <label className="field">
          <span>新建作品默认类型</span>
          <select
            value={defaultWorkKind}
            onChange={(e) => void setDefaultWorkKind(e.target.value as WorkKind)}
          >
            {WORK_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {WORK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <small className="muted">点「加作品」时自动带上该类型，每个作品仍可单独修改。</small>
        </label>

        <div className="field">
          <span>展示筛选</span>
          <div className="seg-chips" role="group" aria-label="展示筛选">
            {FILTER_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`seg-chip${worksFilter === o.value ? ' active' : ''}`}
                onClick={() => void setWorksFilter(o.value)}
                aria-pressed={worksFilter === o.value}
              >
                {o.label}
              </button>
            ))}
          </div>
          <small className="muted">日常模式与编辑模式列表按所选类型展示；关系图始终展示全部。</small>
        </div>
      </div>
    </Modal>
  )
}
