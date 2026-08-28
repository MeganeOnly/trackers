import { useEffect, useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { buildDonePredicate } from '@shared/done'
import { detectCycles, formatIssues, groupMemberCount, groupMemberId, validateEdges } from '@core'
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
  const { relations } = useUnlocked()

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
  /** picker 单选时『引用次数』步进器（≥1）：count>1 时落 simple spec 带 count */
  const [singleCount, setSingleCount] = useState<number>(1)
  /** picker 多选时每个 member 的 per-member count（默认 1）；仅 countable 任务的 count>=2 会被记入 spec */
  const [groupMemberCounts, setGroupMemberCounts] = useState<Record<string, number>>({})
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
        // key 含 spec.count：同一目标被多次添加（每次不同 count）时 React key 不冲突
        // removeIds 仅含 id（向后兼容旧行为）；removeRow 内部按 spec count 精确匹配
        out.push({
          key: `spec-simple-${i}-${s.id}-${s.count ?? 1}`,
          spec: s,
          label: '',
          detail: nameOf(s.id),
          removeIds: [s.id]
        })
      } else if (s.kind === 'group') {
        const { label } = specLabel(s)
        // 详尽展示：per-member count 写入 detail；
        // 非 countable 或 count=1 的 member 省略 count（保持简洁）。
        out.push({
          key: `spec-group-${i}`,
          spec: s,
          label,
          detail: s.members
            .map((m): string => {
              const id = groupMemberId(m)
              const c = groupMemberCount(m)
              const isCountable = goalById.get(id)?.countable ?? false
              if (isCountable && c >= 2) {
                const cur = goalById.get(id)?.progress?.current ?? 0
                return `${nameOf(id)} (${cur}/${c})`
              }
              return nameOf(id)
            })
            .join(' 或 '),
          removeIds: s.members.map(groupMemberId)
        })
      } else {
        const done = s.members.filter((m) => isDone(groupMemberId(m), 1)).length
        const total = s.members.length
        const { label } = specLabel(s)
        out.push({
          key: `spec-count-${i}`,
          spec: s,
          label,
          detail: s.members
            .map((m): string => {
              const id = groupMemberId(m)
              const c = groupMemberCount(m)
              const isCountable = goalById.get(id)?.countable ?? false
              return isCountable && c >= 2 ? `${nameOf(id)} ×${c}` : nameOf(id)
            })
            .join('、'),
          progress: { current: done, total },
          removeIds: s.members.map(groupMemberId)
        })
      }
    }
    // 裸 id：specs 里没出现的成员（旧数据或纯 simple list）
    const inSpecsOrGroups = new Set<string>([
      ...groupMemberIds,
      ...specs.flatMap((s) => {
        if (s.kind === 'simple') return [s.id]
        if (s.kind === 'group' || s.kind === 'count') return s.members.map(groupMemberId)
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

  // 「完成后将解锁」= 直接被本目标阻塞的下游节点（不传递;链式影响由调用方自 BFS）
  const downstreamIds = relations.get(goalId)?.blocks ?? []
  const downstreamGoals = downstreamIds
    .map((id) => goalById.get(id))
    .filter((g): g is Goal => Boolean(g))
  const missingDownstreamIds = downstreamIds.filter((id) => !goalById.has(id))

  // 已 added simple spec 同 id 的次数（用于 picker 视觉提示）
  const simpleSpecCountById = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of specs) {
      if (s.kind === 'simple') m.set(s.id, (m.get(s.id) ?? 0) + 1)
    }
    return m
  }, [specs])

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return goals
      .filter((b) => b.id !== goalId)
      // countable 任务允许重复添加（每次作为独立 simple spec，引用次数不同）
      // 非 countable 仍按"已添加则不再出现"过滤
      .filter((b) => !allPrereqIds.includes(b.id) || b.countable)
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
    setGroupMemberCounts({})
  }
  function setGroupMemberCount(id: string, n: number): void {
    const v = Math.max(1, Math.min(99, Math.floor(n) || 1))
    setGroupMemberCounts((prev) => ({ ...prev, [id]: v }))
  }
  async function addMultiAs(kind: 'group' | 'count', need: number): Promise<void> {
    const ids = Array.from(pickerSel)
    if (ids.length < 2) return
    // group 形态：把每个 member 按其 per-member count 包成 `{id, count}` 对象。
    // 仅 countable 任务的 count > 1 才记录到 member；非 countable 与 count=1 一律走
    // 字符串形态（与旧 relations.json 兼容，省 count 字段）。
    const memberObjs = ids.map((id) => {
      const g = goalById.get(id)
      const c = groupMemberCounts[id] ?? 1
      if (g?.countable && c >= 2) return { id, count: c }
      return id
    })
    const spec: PrereqSpec =
      kind === 'group'
        ? { kind: 'group', members: memberObjs, pick: 1 }
        : { kind: 'count', members: ids, need }
    const nextSpecs: PrereqSpec[] = [...(specs), spec]
    await persist({ specs: nextSpecs, rule: 'all', threshold: undefined, clearGroups: true })
    setPickerOpen(false)
    setPickerQuery('')
    clearPickerSel()
    setGroupMemberCounts({})
  }
  async function addSingle(id: string, count: number = 1): Promise<void> {
    const spec: PrereqSpec =
      count >= 2 ? { kind: 'simple', id, count } : { kind: 'simple', id }
    const nextSpecs: PrereqSpec[] = [...(specs), spec]
    await persist({ specs: nextSpecs, rule: rule, threshold: threshold, clearGroups: true })
    setPickerOpen(false)
    setPickerQuery('')
    clearPickerSel()
    setSingleCount(1)
  }

  const excludeCandidates = useMemo(() => {
    return goals.filter((b) => b.id !== goalId).slice(0, 24)
  }, [goals, goalId])

  /** 规整化写入前的 edge：把旧的 groups 字段清空；保留 rule/threshold 备用；specs 是新主源。 */
  async function persist(next: {
    specs?: PrereqSpec[]
    excludes?: ExcludeSpec[]
    /** 显式前置 id 列表：removeRow 用它覆盖推导，避免兜底把已删 id 重新加回 */
    prerequisites?: string[]
    /** 显式 legacy groups：removeRow 用它保留与本次移除无关的组合 */
    groups?: string[][]
    rule?: 'all' | 'any_of'
    threshold?: number
    clearGroups?: boolean
  }): Promise<void> {
    const baseEdge: Edge = myEdge
      ? { ...myEdge }
      : { to: goalId, prerequisites: [], rule: 'all' as const }

    // 计算新 prerequisites（specs + excludes 不算）
    const nextSpecs = next.specs ?? baseEdge.specs ?? []
    let newPrereqIds: string[]
    if (next.prerequisites !== undefined) {
      // 显式给出（removeRow）：直接采用，跳过兜底
      newPrereqIds = next.prerequisites
    } else {
      newPrereqIds = []
      const seen = new Set<string>()
      const positiveSpecs = nextSpecs.filter((s) => s.kind !== 'exclude')
      for (const s of positiveSpecs) {
        if (s.kind === 'simple') {
          if (!seen.has(s.id)) {
            seen.add(s.id)
            newPrereqIds.push(s.id)
          }
        } else {
          for (const m of s.members) {
            const id = groupMemberId(m)
            if (!seen.has(id)) {
              seen.add(id)
              newPrereqIds.push(id)
            }
          }
        }
      }
      // 旧裸 id 兜底：凡不被『新 specs / 生效后的 groups』覆盖的裸 id 一律保留。
      // 不能只在 specs 为空时兜底 —— 否则 specs 与旧裸 id 混存时，任何非删除操作
      // （加 spec / 加互斥规则 / 切规则）都会把裸 id 静默丢掉。
      const covered = new Set(seen)
      const effectiveGroups =
        next.groups !== undefined
          ? next.groups
          : next.clearGroups
            ? []
            : (baseEdge.groups ?? [])
      for (const g of effectiveGroups) for (const m of g) covered.add(m)
      for (const id of baseEdge.prerequisites) {
        if (!covered.has(id)) {
          covered.add(id)
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
      groups: next.groups !== undefined ? next.groups : next.clearGroups ? undefined : baseEdge.groups,
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
    // 不变量告警（只警告，不阻止保存）：同一个 to 出现多条边会让 computeUnlocked
    // 静默丢弃前置条件。上面的 filter + push 是 upsert 语义，正常不会触发；
    // 这里守的是将来改动这段拼接逻辑时无声引入重复边。详见 @core 的 validate 模块。
    const invariantMsg = formatIssues(validateEdges(updated))
    if (invariantMsg) console.warn('[PrereqEditor]', invariantMsg)
    await setAll(updated)
  }

  async function removeRow(row: RenderedRow): Promise<void> {
    // 从 specs + groups 里同步移除
    const removeSet = new Set(row.removeIds)
    // simple spec 精确匹配：key `spec-simple-${i}-${s.id}-${s.count ?? 1}` 末段即 (id, count)
    // —— 同一目标被多次添加时，只移除该 (id, count) 实例，不误伤其他实例。
    // row.spec 是对应 spec，从 key 末段解析 count 比 parse 字符串更可靠。
    const targetSimpleCount =
      row.spec.kind === 'simple' ? (row.spec.count ?? 1) : null
    const nextSpecs: PrereqSpec[] = (specs)
      .map((s) => {
        if (s.kind === 'simple') {
          // 仅当 id 命中移除集合且 count 等于目标 count 才移除（null 兜底：兼容旧数据）
          if (targetSimpleCount === null) {
            return removeSet.has(s.id) ? null : s
          }
          if (removeSet.has(s.id) && (s.count ?? 1) === targetSimpleCount) return null
          return s
        }
        if (s.kind === 'group' || s.kind === 'count') {
          const left = s.members.filter((m) => !removeSet.has(groupMemberId(m)))
          if (left.length === 0) return null
          return { ...s, members: left }
        }
        return s
      })
      .filter((s): s is PrereqSpec => s !== null)
    // 只剔除本次移除涉及的 legacy groups，无关组合保留（避免误清）
    const nextGroups = groups.filter((g) => !g.some((m) => removeSet.has(m)))
    // v3：保留 (a) 仍在某 spec/group 的 id（用于"同一目标多次添加"的去重判定）；
    //         (b) 旧裸 id 不在 removeSet 中（与 dev-notes §5 兜底一致）。
    const remainingIds = new Set<string>()
    for (const s of nextSpecs) {
      if (s.kind === 'simple') remainingIds.add(s.id)
      else if (s.kind === 'group' || s.kind === 'count') {
        for (const m of s.members) remainingIds.add(groupMemberId(m))
      }
    }
    for (const g of nextGroups) for (const m of g) remainingIds.add(m)
    const nextPrereqIds = allPrereqIds.filter(
      (id) => remainingIds.has(id) || !removeSet.has(id)
    )
    await persist({
      specs: nextSpecs,
      prerequisites: nextPrereqIds,
      groups: nextGroups,
      rule,
      threshold
    })
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
    // 同一成员不能同时出现在多个组合（legacy groups + spec group/count 都算）
    const inAnyExistingGroup = new Set<string>([
      ...groups.flat(),
      ...(specs).flatMap((s) =>
        s.kind === 'group' || s.kind === 'count' ? s.members.map(groupMemberId) : []
      )
    ])
    const dup = members.filter((m) => inAnyExistingGroup.has(m))
    if (dup.length > 0) {
      alert('所选前置里已有成员属于其他组合，请先移除再组合。')
      return
    }
    const nextSpecs: PrereqSpec[] = [
      ...(specs),
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
    // 互斥规则独立于组合/规格，不清理 legacy groups
    void persist({ excludes: newExcludes })
    setExcludePickerOpen(false)
  }
  async function removeExclude(idx: number): Promise<void> {
    // 渲染列表是 excludes + specs 里的 exclude 合并后的，删除时两边都要按索引过滤
    const mergedExcludes: ExcludeSpec[] = [
      ...excludes,
      ...((specs).filter((s) => s.kind === 'exclude') as ExcludeSpec[])
    ]
    const target = mergedExcludes[idx]
    if (!target) return
    const nextExcludes = excludes.filter((e) => e !== target)
    const nextSpecs = (specs).filter((s) => s !== target)
    // 互斥规则独立于组合/规格，不清理 legacy groups
    await persist({ excludes: nextExcludes, specs: nextSpecs })
  }

  // 重置本地状态当 goalId 变化
  useEffect(() => {
    setPickerOpen(false)
    setPickerQuery('')
    setPickerSel(new Set())
    setSingleCount(1)
    setGroupMemberCounts({})
    setGrouping(false)
    setGroupSel(new Set())
    setExcludePickerOpen(false)
  }, [goalId])

  const hasPositiveSpecs = (specs).some((s) => s.kind !== 'exclude')
  const hasAnyPrereq = allPrereqIds.length > 0 || (specs).some((s) => s.kind !== 'exclude')

  return (
    <section className="detail-prereqs">
      <h3>
        前置依赖 <span className="muted">({allPrereqIds.length} 个)</span>
      </h3>

      {/* 互斥规则栏（exclude）—— 独立于前置 chip */}
      {(excludes.length > 0 || (specs).some((s) => s.kind === 'exclude')) && (
        <div className="prereq-excludes">
          <div className="prereq-excludes-title">互斥 / 失效规则</div>
          <ul>
            {[
              ...excludes,
              ...((specs).filter((s) => s.kind === 'exclude') as ExcludeSpec[])
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

      {/* 反向视角：完成本目标会直接推动谁解锁。仅显示直接一步可达的邻居 */}
      {(downstreamGoals.length > 0 || missingDownstreamIds.length > 0) && (
        <div className="downstream">
          <h4 className="downstream-title">
            完成后将解锁 <span className="muted">({downstreamIds.length} 个)</span>
          </h4>
          <ul className="downstream-list">
            {downstreamGoals.map((g) => (
              <li
                key={g.id}
                className={`downstream-item status-${g.status}`}
                onClick={() => select(g.id)}
              >
                <span className="title">{g.title}</span>
                {g.category && <span className="muted">{g.category}</span>}
                <span className={`status-tag status-${g.status}`}>{STATUS_LABELS[g.status]}</span>
              </li>
            ))}
            {missingDownstreamIds.map((id) => (
              <li key={id} className="downstream-item downstream-missing">
                <span className="title">{id}</span>
                <span className="muted">未找到</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
              candidates.map((b) => {
                const addedCount = simpleSpecCountById.get(b.id) ?? 0
                const alreadyAdded = addedCount > 0
                return (
                  <li
                    key={b.id}
                    className={`${pickerSel.has(b.id) ? 'picker-sel' : ''}${alreadyAdded && b.countable ? ' picker-reusable' : ''}`}
                    onClick={() => togglePickerSel(b.id)}
                    title={
                      alreadyAdded && b.countable
                        ? `已添加为前置 ×${addedCount}（可再次添加以指定不同引用次数）`
                        : undefined
                    }
                  >
                    <span className={`group-pick${pickerSel.has(b.id) ? ' picked' : ''}`}>
                      {pickerSel.has(b.id) ? '✓' : ''}
                    </span>
                    <span className="title">{b.title}</span>
                    <span className="author muted">{b.category || ''}</span>
                    {alreadyAdded && b.countable && (
                      <span className="picker-reused-badge muted">
                        已添加 ×{addedCount}
                      </span>
                    )}
                  </li>
                )
              })
            )}
          </ul>
          {pickerSel.size > 0 && (
            <div className="picker-mode">
              <span className="muted">
                已选 <strong>{pickerSel.size}</strong> 个：
              </span>
              {pickerSel.size === 1 && (
                <>
                  <span className="single-count-row">
                    <span className="muted">引用次数</span>
                    <button
                      className="btn-secondary"
                      onClick={() => setSingleCount((n) => Math.max(1, n - 1))}
                      title="减 1"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={singleCount}
                      onChange={(e) =>
                        setSingleCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))
                      }
                      className="threshold-input"
                      title="引用次数（仅当目标是 countable 任务时生效）"
                    />
                    <button
                      className="btn-secondary"
                      onClick={() => setSingleCount((n) => Math.min(99, n + 1))}
                      title="加 1"
                    >
                      ＋
                    </button>
                  </span>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      const id = Array.from(pickerSel)[0]
                      void addSingle(id, singleCount)
                    }}
                    title="把已选目标作为单个前置添加（count>1 时表示引用方需要它达到多少次）"
                  >
                    作为单个前置添加{singleCount >= 2 ? `（×${singleCount}）` : ''}
                  </button>
                </>
              )}
              {pickerSel.size >= 2 && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => void addMultiAs('group', 1)}
                    title="把已选目标组成『任选其一』的组合；每个 member 可单独设引用次数（仅 countable 任务生效）"
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
                  {/* per-member 引用次数选择器（仅对 countable 任务生效） */}
                  <details className="group-member-counts">
                    <summary className="muted">
                      各成员引用次数
                      {Object.values(groupMemberCounts).some((c) => c >= 2)
                        ? '（含自定义）'
                        : '（仅 countable 任务可改）'}
                    </summary>
                    <ul className="member-count-list">
                      {Array.from(pickerSel).map((id) => {
                        const g = goalById.get(id)
                        const isCountable = !!g?.countable
                        const v = groupMemberCounts[id] ?? 1
                        return (
                          <li key={id} className={`member-count-row${isCountable ? '' : ' disabled'}`}>
                            <span className="member-name">{nameOf(id)}</span>
                            {!isCountable && <span className="muted">非 countable</span>}
                            {isCountable && (
                              <>
                                <button
                                  className="btn-secondary"
                                  onClick={() => setGroupMemberCount(id, v - 1)}
                                  title="减 1"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={99}
                                  value={v}
                                  onChange={(e) =>
                                    setGroupMemberCount(id, Number(e.target.value))
                                  }
                                  className="threshold-input"
                                  title="该 member 的引用次数（默认 1）"
                                />
                                <button
                                  className="btn-secondary"
                                  onClick={() => setGroupMemberCount(id, v + 1)}
                                  title="加 1"
                                >
                                  ＋
                                </button>
                                <span className="muted">×{v}</span>
                              </>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </details>
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
                </>
              )}
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
    // count 标签规则：
    //   - 目标是 countable → 始终显示「(current/N)」ratio（current=N 即满足）
    //   - 非 countable 且 spec.count >= 2 → ×N（沿用旧行为；countable 字段不适用 ratio）
    const showCountTag = g?.countable || (spec.count !== undefined && spec.count >= 2)
    const countTagText = (() => {
      const n = spec.count ?? 1
      if (g?.countable) {
        const cur = g.progress?.current ?? 0
        return `(${cur}/${n})`
      }
      return `×${n}`
    })()
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
        {showCountTag && <span className="count-tag">{countTagText}</span>}
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