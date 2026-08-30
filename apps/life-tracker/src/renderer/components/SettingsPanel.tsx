import { Modal } from './Modal'
import { useSettingsStore } from '../store/settings'
import { ALL_THEMES, ALL_FORMATS, THEME_META, FORMAT_META } from '@ui/useTheme'
import type { ThemeName, FormatName } from '@ui/useTheme'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const format = useSettingsStore((s) => s.format)
  const setFormat = useSettingsStore((s) => s.setFormat)

  return (
    <Modal title="设置" onClose={onClose} width={560}>
      <div className="settings-panel">
        <div className="field">
          <span>外观 · 样式风格</span>
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
                    <span className="theme-card-hint">{meta.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          <span>外观 · 格式风格（与样式风格独立）</span>
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
                >
                  <pre className="format-card-wire" aria-hidden="true">
                    {meta.wireframe}
                  </pre>
                  <span className="format-card-meta">
                    <span className="format-card-label">{meta.label}</span>
                    <span className="format-card-hint">{meta.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <small className="muted">样式风格（颜色/字体/圆角）与格式风格（信息呈现方式）正交，可任意组合。</small>
        </div>
      </div>
    </Modal>
  )
}
