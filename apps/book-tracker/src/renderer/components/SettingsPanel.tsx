import { useSettingsStore } from '../store/settings'
import { Modal } from './Modal'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { SidebarSeriesEntryMode, WorkKind } from '@shared/types'
import { ALL_THEMES, ALL_FORMATS, THEME_META, FORMAT_META } from '@ui/useTheme'
import type { ThemeName, FormatName } from '@ui/useTheme'

interface SettingsPanelProps {
  onClose: () => void
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部作品' },
  ...WORK_KIND_ORDER.map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))
]

// v2.x 侧栏系列入口模式选项(当前固定 1 项,后续可加更多 preset)
const SERIES_ENTRY_MODES: { value: SidebarSeriesEntryMode; label: string; hint: string }[] = [
  {
    value: 'inline-row',
    label: '插入到状态分组',
    hint: '系列徽章插入到各 status 分组顶部,跨 status 可重复出现;搜索时去重一次。'
  }
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
  const sidebarSeriesEntryMode = useSettingsStore((s) => s.sidebarSeriesEntryMode)
  const setSidebarSeriesEntryMode = useSettingsStore((s) => s.setSidebarSeriesEntryMode)
  const useLocalFonts = useSettingsStore((s) => s.useLocalFonts)
  const setUseLocalFonts = useSettingsStore((s) => s.setUseLocalFonts)
  const useCozyTokens = useSettingsStore((s) => s.useCozyTokens)
  const setUseCozyTokens = useSettingsStore((s) => s.setUseCozyTokens)

  return (
    <Modal title="设置" onClose={onClose} width={560} className="settings-modal">
      <div className="settings-panel">
        {/* v2.x 候选剧集已拆为独立 modal(顶栏「待选」按钮),不再嵌在设置里。
            设置面板回归单栏;第一行两列紧凑布局:新建默认类型 + 展示筛选。 */}
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
            <InfoTip tip="信息呈现方式(列表 / 网格 / 聚焦栈)。与「样式风格」正交,可任意组合。" />
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

        {/* v2.x 侧栏系列入口模式 —— 编辑模式 BookList 里 series 怎么呈现。
            当前只有 1 个选项,后续若加更多展示方式可扩展;切完立即重新渲染 BookList。 */}
        <div className="field">
          <span className="field-label">
            侧栏系列入口
            <InfoTip tip="编辑模式左侧栏如何呈现系列。当前只一种模式;后续可加更多。" />
          </span>
          <div className="seg-chips" role="radiogroup" aria-label="侧栏系列入口">
            {SERIES_ENTRY_MODES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={sidebarSeriesEntryMode === o.value}
                className={`seg-chip${sidebarSeriesEntryMode === o.value ? ' active' : ''}`}
                onClick={() => void setSidebarSeriesEntryMode(o.value)}
                data-tip={o.hint}
                aria-label={`${o.label} — ${o.hint}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* 视觉微调开关组 —— 默认全 OFF,行为与现状一字不动;用户主动 ON 才生效。
            每个开关独立 seg-chip (ON / OFF),切换立即写到 DOM data-* 触发 base.css 选择器。 */}
        <div className="field">
          <span className="field-label">
            外观 · 字体加载
            <InfoTip
              tip={
                '只影响 library / codex 主题(Fraunces 衬线字体)。\n' +
                '· 本地（ON）：用 packages/tracker-ui/src/fonts/ 里的 ttf 文件，offline 也能用，体积约 460KB。\n' +
                '· CDN（OFF，默认）：用 Google Fonts 远程加载，受网络影响但零本地占用。'
              }
            />
          </span>
          <div className="seg-chips" role="radiogroup" aria-label="字体加载">
            <button
              type="button"
              role="radio"
              aria-checked={!useLocalFonts}
              className={`seg-chip${!useLocalFonts ? ' active' : ''}`}
              onClick={() => void setUseLocalFonts(false)}
            >
              CDN（默认）
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={useLocalFonts}
              className={`seg-chip${useLocalFonts ? ' active' : ''}`}
              onClick={() => void setUseLocalFonts(true)}
            >
              本地
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            外观 · 视觉舒适
            <InfoTip
              tip={
                '让圆角略大、阴影略柔(仅共享基座 token)。\n' +
                '· 开：radius-sm 2→3 / radius-md 4→6 / radius-lg 8→10，整体边缘更圆润。\n' +
                '· 关（默认）：原 token，行为与现状一字不动。\n' +
                '不动间距 / 字号 / 字体（动了破坏既有对齐）。'
              }
            />
          </span>
          <div className="seg-chips" role="radiogroup" aria-label="视觉舒适">
            <button
              type="button"
              role="radio"
              aria-checked={!useCozyTokens}
              className={`seg-chip${!useCozyTokens ? ' active' : ''}`}
              onClick={() => void setUseCozyTokens(false)}
            >
              标准（默认）
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={useCozyTokens}
              className={`seg-chip${useCozyTokens ? ' active' : ''}`}
              onClick={() => void setUseCozyTokens(true)}
            >
              柔和
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}