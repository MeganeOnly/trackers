import { useEffect, useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { buildDonePredicate } from '@shared/done'
import { detectCycles } from '@core'
import type {
  Edge,
  ExcludeSpec,
  Goal,
  GoalStatus,
  PrereqSpec
} from '@shared/types'

interface PrereqEditorProps {
  goalId: string
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

/**
 * 把当前 edge 的『前置规格』展开成 UI 行。
 * - 旧 edge.groups 字段在读时映射成 group spec（旧数据兼容）；
 * - 不在 specs / groups 里的『裸 id』渲染成 simple。
 *
 * 注意：返回的列表里 exclude **不**作为行渲染（exclude 走顶部互斥栏）。
 */
interface RenderedRow {
  key: string
  spec: PrereqSpec
  /** UI 显示用的标签 / 描述 / 当前进度等 */
  label: string
  detail: string
  progress?: { current: number; total: number }
  /** 整条移除时从 edge 里剥掉哪些 id */
  removeIds: string[]
}

function specLabel(spec: PrereqSpec): { label: string; detail: string } {
  switch (spec.kind) {
    case 'simple':
      return { label: '', detail: '' }
    case 'group': {
      const pick = spec.pick ?? 1
      const n = spec.members.length
      const head = pick === 1 ? '组合（任选其一）' : `组合（N 选 ${pick}）`
      return { label: head, detail: `${n} 个成员` }
    }
    case 'count': {
      const n = spec.members.length
      return { label: '计数任务', detail: `${n} 选 ${spec.need}` }
    }
    case 'exclude':
      return { label: '', detail: '' }
  }
}

export function PrereqEditor({ goalId }: PrereqEditorProps): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const setAll = useRelationsStore((s) => s.setAll)
  const select = useGoalsStore((s) => s.select)

  const myEdge = edges.find((e) => e.to === goalId) ?? null
  const rule = myEdge?.rule ?? 'all'
  const threshold = myEdge?.threshold ?? 0
  const groups: string[][] = myEdge?.groups ?? []
  const specs: PrereqSpec[] = myEdge?.specs ?? []
  const excludes: ExcludeSpec[] = myEdge?.excludes ?? []
  const allPrereqIds: string[] = myEdge?.prerequisites ?? []

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  /** picker 内『多选目标』状态：选中后用下方三种模式之一落 spec */
  const [pickerSel, setPickerSel] = useState<Set<string>>(new Set())
  const [countNeed, setCountNeed] = useState<number>(2)
  const [grouping, setGrouping] = useState(false)
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set())
  const [excludePickerOpen, setExcludePickerOpen] = useState(false)

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals])
  const nameOf = (id: string): string => goalById.get(id)?.title ?? id

  // 已 done 谓词：用于显示计数任务进度
  const { isDone } = useMemo(() => buildDonePredicate(goals, edges), [goals, edges])

  // 把 specs + groups（旧字段）+ 裸 id 拼成渲染行
  const rows: RenderedRow[] = useMemo(() => {
    const out: RenderedRow[] = []
    const groupMemberIds = new Set<string>()
    for (let i = 0; i < groups.length; i++) {
      const members = groups[i]
      for (const m of members) groupMemberIds.add(m)
      const memberTitles = members.map(nameOf).join(' 或 ')
      out.push({
        key: `legacy-group-${i}`,
        spec: { kind: 'group', members, pick: 1 },
        label: `组合 ${i + 1}（任选其一）`,
        detail: memberTitles,
        removeIds: members
      })
    }
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]
      if (s.kind === 'exclude') continue
      if (s.kind === 'simple') {
        out.push({
          key: `spec-simple-${i}-${s.id}`,
          spec: s,
          label: '',
          detail: nameOf(s.id),
          removeIds: [s.id]
        })
      } else if (s.kind === 'group') {
        const { label } = specLabel(s)
        out.push({
          key: `spec-group-${i}`,
          spec: s,
          label,
          detail: s.members.map(nameOf).join(' 或 '),
          removeIds: [...s.members]
        })
      } else {
        const done = s.members.filter(isDone).length
        const total = s.members.length
        const { label } = specLabel(s)
        out.push({
          key: `spec-count-${i}`,
          spec: s,
          label,
          detail: s.members.map(nameOf).join('、'),
          progress: { current: done, total },
          removeIds: [...s.members]
        })
      }
    }
    // 裸 id：specs 里没出现的成员（旧数据或纯 simple list）
    const inSpecsOrGroups = new Set<string>([
      ...groupMemberIds,
      ...specs.flatMap((s) => {
        if (s.kind === 'simple') return [s.id]
        if (s.kind === 'group' || s.kind === 'count') return s.members
        return []
      })
    ])
    for (const id of allPrereqIds) {
      if (inSpecsOrGroups.has(id)) continue
      out.push({
        key: `bare-${id}`,
        spec: { kind: 'simple', id },
        label: '',
        detail: nameOf(id),
        removeIds: [id]
      })
    }
    return out
  }, [groups, specs, allPrereqIds, goalById, isDone])

  const missingIds = allPrereqIds.filter((id) => !goalById.has(id))

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return goals
      .filter((b) => b.id !== goalId)
      .filter((b) => !allPrereqIds.includes(b.id))
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.category.toLowerCase().includes(q))
      .slice(0, 12)
  }, [goals, goalId, allPrereqIds, pickerQuery])

  function togglePickerSel(id: string): void {
    setPickerSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function clearPickerSel(): void {
    setPickerSel(new Set())
  }
  async function addMultiAs(kind: 'group' | 'count', need: number): Promise<void> {
    const members = Array.from(pickerSel)
    if (members.length < 2) return
    const spec: PrereqSpec =
      kind === 'group'
        ? { kind: 'group', members, pick: 1 }
        : { kind: 'count', members, need }
    const nextSpecs: PrereqSpec[] = [...(specs ?? []), spec]
    await persist({ specs: nextSpecs, rule: 'all', threshold: undefined, clearGroups: true })
    setPickerOpen(false)
    setPickerQuery('')
    clearPickerSel()
  }
  async function addSingle(id: string): Promise<void> {
    const nextSpecs: PrereqSpec[] = [
      ...(specs ?? []),
      { kind: 'simple', id }
    ]
    await persist({ specs: nextSpecs, rule: rule, threshold: threshold, clearGroups: true })
  }

  const excludeCandidates = useMemo(() => {
    return goals.filter((b) => b.id !== goalId).slice(0, 24)
  }, [goals, goalId])

  /** 规整化写入前的 edge：把旧的 groups 字段清空；保留 rule/threshold 备用；specs 是新主源。 */
  async function persist(next: {
    specs?: PrereqSpec[]
    excludes?: ExcludeSpec[]
    rule?: 'all' | 'any_of'
    threshold?: number
    clearGroups?: boolean
  }): Promise<void> {
    const baseEdge: Edge = myEdge
      ? { ...myEdge }
      : { to: goalId, prerequisites: [], rule: 'all' as const }

    // 计算新 prerequisites（specs + excludes 不算）
    const nextSpecs = next.specs ?? baseEdge.specs ?? []
    const positiveSpecs = nextSpecs.filter((s) => s.kind !== 'exclude')
    const newPrereqIds: string[] = []
    const seen = new Set<string>()
    for (const s of positiveSpecs) {
      if (s.kind === 'simple') {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          newPrereqIds.push(s.id)
        }
      } else {
        for (const m of s.members) {
          if (!seen.has(m)) {
            seen.add(m)
            newPrereqIds.push(m)
          }
        }
      }
    }
    // 兜底：旧裸 id（既不在 specs 也不在 groups 里）
    if (positiveSpecs.length === 0 && (baseEdge.specs?.length ?? 0) === 0) {
      for (const id of baseEdge.prerequisites) {
        if (!seen.has(id)) {
          seen.add(id)
          newPrereqIds.push(id)
        }
      }
    }

    const newExcludes = next.excludes ?? baseEdge.excludes ?? []

    const newEdge: Edge = {
      ...baseEdge,
      to: goalId,
      prerequisites: newPrereqIds,
      rule: next.rule ?? baseEdge.rule,
      threshold: next.threshold ?? baseEdge.threshold,
      groups: next.clearGroups ? undefined : baseEdge.groups,
      specs: nextSpecs.length > 0 ? nextSpecs : undefined,
      excludes: newExcludes.length > 0 ? newExcludes : undefined
    }

    // 仅保留正向 spec 即可触发 specs 路径；其他情况保留旧字段
    if ((newEdge.specs?.filter((s) => s.kind !== 'exclude').length ?? 0) === 0) {
      // 没有正向 spec 时清空 specs（让旧 rule+groups 路径生效）
      newEdge.specs = undefined
    }

    const others = edges.filter((e) => e.to !== goalId)
    const updated = [...others, newEdge]

    const cycles = detectCycles(updated)
    if (cycles.some((c) => c.includes(goalId))) {
      alert('此修改会造成循环依赖，请先调整其他前置。')
      return
    }
    await setAll(updated)
  }

  async function removeRow(row: RenderedRow): Promise<void> {
    // 从 specs + groups 里同步移除
    const removeSet = new Set(row.removeIds)
    const nextSpecs: PrereqSpec[] = (specs ?? [])
      .map((s) => {
        if (s.kind === 'simple') return removeSet.has(s.id) ? null : s
        if (s.kind === 'group' || s.kind === 'count') {
          const left = s.members.filter((m) => !removeSet.has(m))
          if (left.length === 0) return null
          return { ...s, members: left }
        }
        return s
      })
      .filter((s): s is PrereqSpec => s !== null)
    const nextGroups = groups.filter((g) => !removeSet.has(g[0]) && g.every((m) => !removeSet.has(m)))
    const nextPrereqIds = allPrereqIds.filter((id) => !removeSet.has(id))
    await persist({
      specs: nextSpecs,
      rule: rule,
      threshold: threshold,
      clearGroups: true
    })
    // 也更新本地显示用的 ids 兜底
    void nextGroups
    void nextPrereqIds
  }

  async function setRule(r: 'all' | 'any_of'): Promise<void> {
    await persist({
      specs: [], // 切到旧路径
      rule: r,
      threshold: r === 'any_of' ? Math.max(1, threshold || 1) : undefined,
      clearGroups: true
    })
  }

  async function setThreshold(n: number): Promise<void> {
    await persist({
      specs: [],
      rule: 'any_of',
      threshold: n,
      clearGroups: true
    })
  }

  async function clearGroups(): Promise<void> {
    await persist({
      specs: [],
      excludes: [],
      rule: 'all',
      threshold: undefined,
      clearGroups: true
    })
  }

  function enterGrouping(): void {
    setGrouping(true)
    setGroupSel(new Set())
  }
  function cancelGrouping(): void {
    setGrouping(false)
    setGroupSel(new Set())
  }
  function toggleGroupSel(id: string): void {
    setGroupSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function confirmGroup(): Promise<void> {
    const members = allPrereqIds.filter((id) => groupSel.has(id))
    if (members.length < 2) return
    // 同一成员不能同时出现在多个 group
    const inAnyExistingGroup = new Set(groups.flat())
    const dup = members.filter((m) => inAnyExistingGroup.has(m))
    if (dup.length > 0) {
      alert('所选前置里已有成员属于其他组合，请先移除再组合。')
      return
    }
    const nextSpecs: PrereqSpec[] = [
      ...(specs ?? []),
      { kind: 'group', members, pick: 1 }
    ]
    await persist({ specs: nextSpecs, rule: 'all', threshold: undefined, clearGroups: true })
    cancelGrouping()
  }

  // 互斥规则相关
  function addExclude(trigger: string, target: string): void {
    if (!trigger || !target || trigger === target) return
    const newExcludes: ExcludeSpec[] = [
      ...excludes,
      { kind: 'exclude', trigger, target, effect: 'disqualifies' }
    ]
    void persist({ excludes: newExcludes, clearGroups: true })
    setExcludePickerOpen(false)
  }
  async function removeExclude(idx: number): Promise<void> {
    const nextExcludes = excludes.filter((_, i) => i !== idx)
    await persist({ excludes: nextExcludes, clearGroups: true })
  }

  // 重置本地状态当 goalId 变化
  useEffect(() => {
    setPickerOpen(false)
    setPickerQuery('')
    setPickerSel(new Set())
    setGrouping(false)
    setGroupSel(new Set())
    setExcludePickerOpen(false)
  }, [goalId])

  const hasPositiveSpecs = (specs ?? []).some((s) => s.kind !== 'exclude')
  const hasAnyPrereq = allPrereqIds.length > 0 || (specs ?? []).some((s) => s.kind !== 'exclude')

  return (
    <section className="detail-prereqs">
      <h3>
        前置依赖 <span className="muted">({allPrereqIds.length} 个)</span>
      </h3>

      {/* 互斥规则栏（exclude）—— 独立于前置 chip */}
      {(excludes.length > 0 || (specs ?? []).some((s) => s.kind === 'exclude')) && (
        <div className="prereq-excludes">
          <div className="prereq-excludes-title">互斥 / 失效规则</div>
          <ul>
            {[
              ...excludes,
              ...((specs ?? []).filter((s) => s.kind === 'exclude') as ExcludeSpec[])
            ].map((ex, i) => (
              <li key={i} className="prereq-exclude">
                <span className="exclude-label">
                  若 <strong>{nameOf(ex.trigger)}</strong> 已达成
                </span>
                <span className="exclude-arrow">→</span>
                <span className="exclude-target">
                  <strong>{nameOf(ex.target)}</strong>{' '}
                  视为
                  {ex.effect === 'disqualifies' ? '失格' : '已满足'}
                </span>
                <button
                  className="exclude-remove"
                  title="移除该规则"
                  onClick={() => void removeExclude(i)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 旧规则切换：仅当没 specs 时显示（沿用旧 UX 兼容） */}
      {!hasPositiveSpecs && allPrereqIds.length > 0 && (
        <div className="rule-row">
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'all'}
              onChange={() => setRule('all')}
            />
            <span>全部达成才解锁</span>
          </label>
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'any_of'}
              onChange={() => setRule('any_of')}
            />
            <span>至少</span>
            <input
              type="number"
              min={1}
              max={allPrereqIds.length}
              value={threshold || allPrereqIds.length}
              onChange={(e) =>
                setThreshold(Math.max(1, Math.min(allPrereqIds.length, Number(e.target.value) || 1)))
              }
              disabled={rule !== 'any_of'}
              className="threshold-input"
            />
            <span>个解锁</span>
          </label>
        </div>
      )}

      {/* 统一的 chip 列表 —— 不再有『异形 .or-group』 */}
      {rows.length > 0 && (
        <ul className="prereq-chips">
          {rows.map((row) => (
            <PrereqChip
              key={row.key}
              row={row}
              goalById={goalById}
              onRemove={() => void removeRow(row)}
              onSelect={(id) => select(id)}
              grouping={grouping}
              groupSel={groupSel}
              toggleGroupSel={toggleGroupSel}
            />
          ))}
        </ul>
      )}

      {missingIds.length > 0 && (
        <ul className="prereq-chips">
          {missingIds.map((id) => (
            <li key={id} className="prereq prereq-missing">
              <span className="title">{id}</span>
              <span className="muted">未找到</span>
              <button
                className="prereq-remove"
                onClick={() => void removeRow({ key: `missing-${id}`, spec: { kind: 'simple', id }, label: '', detail: id, removeIds: [id] })}
                title="移除前置"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!hasAnyPrereq && <p className="muted empty-hint">无前置 —— 此目标永远解锁</p>}

      <div className="prereq-actions">
        <button className="add-prereq" onClick={() => setPickerOpen((v) => !v)}>
          + 添加前置
        </button>
        {!grouping ? (
          <button
            className="add-prereq"
            onClick={enterGrouping}
            disabled={allPrereqIds.length < 2}
            title="把 2 个及以上前置组成『任选其一』的组合"
          >
            ⚑ 组合二选一
          </button>
        ) : (
          <span className="group-bar">
            <span className="muted">已选 {groupSel.size} 个（至少 2 个）</span>
            <button
              className="btn-primary"
              onClick={() => void confirmGroup()}
              disabled={groupSel.size < 2}
            >
              确定组合
            </button>
            <button className="btn-secondary" onClick={cancelGrouping}>
              取消
            </button>
          </span>
        )}
        <button
          className="add-prereq"
          onClick={() => setExcludePickerOpen((v) => !v)}
          title="新增一条『若 X 达成则 Y 不再算前置』的互斥规则"
        >
          ⊘ 加互斥规则
        </button>
        {(groups.length > 0 || hasPositiveSpecs) && (
          <button
            className="link-btn"
            onClick={() => void clearGroups()}
            title="清空所有组合 / 规则，回到简单列表"
          >
            清除组合 / 规则
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="prereq-picker">
          <input
            type="search"
            placeholder="搜索目标 / 分类..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
          />
          <ul>
            {candidates.length === 0 ? (
              <li className="muted">无匹配</li>
            ) : (
              candidates.map((b) => (
                <li
                  key={b.id}
                  className={pickerSel.has(b.id) ? 'picker-sel' : ''}
                  onClick={() => togglePickerSel(b.id)}
                >
                  <span className={`group-pick${pickerSel.has(b.id) ? ' picked' : ''}`}>
                    {pickerSel.has(b.id) ? '✓' : ''}
                  </span>
                  <span className="title">{b.title}</span>
                  <span className="author muted">{b.category || ''}</span>
                </li>
              ))
            )}
          </ul>
          {pickerSel.size > 0 && (
            <div className="picker-mode">
              <span className="muted">
                已选 <strong>{pickerSel.size}</strong> 个：
              </span>
              <button
                className="btn-secondary"
                onClick={() => void addMultiAs('group', 1)}
                title="把已选目标组成『任选其一』的组合"
              >
                任选其一
              </button>
              <button
                className="btn-secondary"
                onClick={() => void addMultiAs('count', pickerSel.size)}
                title="把已选目标组成『全部都要』的计数任务"
              >
                全部都要
              </button>
              <span className="count-need-row">
                <span className="muted">N 选</span>
                <input
                  type="number"
                  min={1}
                  max={pickerSel.size}
                  value={Math.min(countNeed, pickerSel.size)}
                  onChange={(e) =>
                    setCountNeed(
                      Math.max(1, Math.min(pickerSel.size, Number(e.target.value) || 1))
                    )
                  }
                  className="threshold-input"
                />
                <button
                  className="btn-primary"
                  disabled={countNeed < 1 || countNeed > pickerSel.size}
                  onClick={() => void addMultiAs('count', countNeed)}
                  title="把已选目标组成『N 选 K』的计数任务"
                >
                  创建
                </button>
              </span>
              <button className="link-btn" onClick={clearPickerSel}>
                清空选择
              </button>
            </div>
          )}
        </div>
      )}

      {excludePickerOpen && (
        <div className="prereq-picker">
          <p className="muted">
            新增互斥规则：若「触发者」达成，则「受影响目标」视为
            <strong>失格</strong>（不能再算任何前置）。
          </p>
          <div className="field-row">
            <select id="exclude-trigger" className="exclude-select">
              <option value="">选择触发者…</option>
              {excludeCandidates.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <select id="exclude-target" className="exclude-select">
              <option value="">选择受影响目标…</option>
              {excludeCandidates.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={() => {
                const trigger = (document.getElementById('exclude-trigger') as HTMLSelectElement)?.value
                const target = (document.getElementById('exclude-target') as HTMLSelectElement)?.value
                addExclude(trigger, target)
              }}
            >
              添加
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

interface PrereqChipProps {
  row: RenderedRow
  goalById: Map<string, Goal>
  onRemove: () => void
  onSelect: (id: string) => void
  grouping: boolean
  groupSel: Set<string>
  toggleGroupSel: (id: string) => void
}

function PrereqChip({
  row,
  goalById,
  onRemove,
  onSelect,
  grouping,
  groupSel,
  toggleGroupSel
}: PrereqChipProps): JSX.Element {
  const { spec, label, detail, progress } = row

  // simple：渲染成单条『目标 chip』+ 状态 tag
  if (spec.kind === 'simple') {
    const g = goalById.get(spec.id)
    const isGroupSel = grouping && groupSel.has(spec.id)
    return (
      <li
        className={`prereq${grouping ? ' grouping' : ''}${isGroupSel ? ' group-sel' : ''}`}
        onClick={
          grouping
            ? () => toggleGroupSel(spec.id)
            : () => onSelect(spec.id)
        }
      >
        {grouping && (
          <span className={`group-pick${isGroupSel ? ' picked' : ''}`}>{isGroupSel ? '✓' : ''}</span>
        )}
        <span className="title">{detail}</span>
        {g && <span className={`status-tag status-${g.status}`}>{STATUS_LABELS[g.status]}</span>}
        <button
          className="prereq-remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title="移除前置"
          disabled={grouping}
        >
          ×
        </button>
      </li>
    )
  }

  // group / count：单 chip 渲染
  const done = progress?.current ?? 0
  const total = progress?.total ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const ok = spec.kind === 'count' ? done >= spec.need : done >= 1
  // 在 grouping（『组合二选一』模式）下，已是 group / count 的 chip 不可再参与
  // ——它们的成员已经决定了互斥语义；显示成禁用态。
  return (
    <li
      className={`prereq spec-${spec.kind}${ok ? ' spec-satisfied' : ''}${grouping ? ' spec-locked' : ''}`}
      title={grouping ? '组合 / 计数任务不可再参与组合' : undefined}
    >
      {label && <span className="spec-label">{label}</span>}
      <span className="title">{detail}</span>
      {spec.kind === 'count' && total > 0 && (
        <>
          <span className="progress-text">
            {done}/{total}
          </span>
          <span className="progress-bar spec-progress">
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
      {spec.kind === 'group' && total > 0 && (
        <span className="progress-text">
          {done}/{total}
        </span>
      )}
      <button
        className="prereq-remove"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="移除该规则"
        disabled={grouping}
      >
        ×
      </button>
    </li>
  )
}