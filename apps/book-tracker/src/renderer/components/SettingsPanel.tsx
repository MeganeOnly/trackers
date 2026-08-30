import { Modal } from './Modal'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { WorkKind } from '@shared/types'
import { ALL_THEMES, ALL_FORMATS, THEME_META, FORMAT_META } from '@ui/useTheme'
import type { ThemeName, FormatName } from '@ui/useTheme'

interface SettingsPanelProps {
  onClose: () => void
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部作品' },
  ...WORK_KIND_ORDER.map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))
]

// 设置项的「?」说明图标 —— 鼠标悬置 / 键盘聚焦时显示 tooltip,
// aria-label 同时为屏幕阅读器提供语义。
// 不设 title 是为了避免原生 tooltip 与 CSS tooltip 同时弹出。
function InfoTip({ tip }: { tip: string }): JSX.Element {
  return (
    <span
      className="field-info"
      tabIndex={0}
      role="img"
      aria-label={tip}
      data-tip={tip}
    >
      ?
    </span>
  )
}

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const defaultWorkKind = useSettingsStore((s) => s.defaultWorkKind)
  const setDefaultWorkKind = useSettingsStore((s) => s.setDefaultWorkKind)
  const worksFilter = useSettingsStore((s) => s.worksFilter)
  const setWorksFilter = useSettingsStore((s) => s.setWorksFilter)
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const format = useSettingsStore((s) => s.format)
  const setFormat = useSettingsStore((s) => s.setFormat)

  return (
    <Modal
      title="设置"
      onClose={onClose}
      width={560}
      className="settings-modal"
    >
      <div className="settings-panel">
        {/* 第一行：两列紧凑布局 —— 新建默认类型 + 展示筛选 */}
        <div className="settings-row">
          <label className="field">
            <span className="field-label">
              新建作品默认类型
              <InfoTip tip="点「加作品」时自动带上该类型，每个作品仍可单独修改。" />
            </span>
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
          </label>

          <div className="field">
            <span className="field-label">
              展示筛选
              <InfoTip tip="日常模式与编辑模式列表按所选类型展示；关系图始终展示全部。" />
            </span>
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
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            外观 · 样式风格
            <InfoTip tip="颜色 / 字体 / 圆角等视觉风格。与下方「格式风格」正交。" />
          </span>
          <div className="theme-picker" role="radiogroup" aria-label="样式风格">
            {ALL_THEMES.map((id) => {
              const meta = THEME_META[id as ThemeName]
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={theme === id}
                  className={`theme-card${theme === id ? ' active' : ''}`}
                  onClick={() => void setTheme(id)}
                  data-tip={meta.hint}
                  aria-label={`${meta.label} — ${meta.hint}`}
                >
                  <span className="theme-swatch" aria-hidden="true">
                    <span
                      className="theme-swatch-bg"
                      style={{ background: meta.bgHex }}
                    />
                    <span
                      className="theme-swatch-accent"
                      style={{ background: meta.accentHex }}
                    />
                  </span>
                  <span className="theme-card-meta">
                    <span className="theme-card-label">{meta.label}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            外观 · 格式风格
            <InfoTip tip="信息呈现方式（列表 / 网格 / 聚焦栈）。与「样式风格」正交，可任意组合。" />
          </span>
          <div className="format-picker" role="radiogroup" aria-label="格式风格">
            {ALL_FORMATS.map((id) => {
              const meta = FORMAT_META[id as FormatName]
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={format === id}
                  className={`format-card${format === id ? ' active' : ''}`}
                  onClick={() => void setFormat(id)}
                  data-tip={meta.hint}
                  aria-label={`${meta.label} — ${meta.hint}`}
                >
                  <pre className="format-card-wire" aria-hidden="true">
                    {meta.wireframe}
                  </pre>
                  <span className="format-card-meta">
                    <span className="format-card-label">{meta.label}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}