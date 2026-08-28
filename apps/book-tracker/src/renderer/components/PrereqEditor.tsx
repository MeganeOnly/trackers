import { useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { detectCycles, formatIssues, validateEdges } from '@core'
import type { Book, Edge, UnlockRule } from '@shared/types'

interface PrereqEditorProps {
  bookId: string
}

const STATUS_LABELS: Record<Book['status'], string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
}

export function PrereqEditor({ bookId }: PrereqEditorProps): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  const setAll = useRelationsStore((s) => s.setAll)
  const select = useBooksStore((s) => s.select)
  const { relations } = useUnlocked()

  const myEdge = edges.find((e) => e.to === bookId)
  const prereqIds = myEdge?.prerequisites ?? []
  const rule: UnlockRule = myEdge?.rule ?? 'all'
  const threshold = myEdge?.threshold ?? prereqIds.length
  const groups: string[][] = myEdge?.groups ?? []
  // 「完成后将解锁」= 直接被本作品阻塞的下游节点（不传递;链式影响由调用方自 BFS）
  const downstreamIds = relations.get(bookId)?.blocks ?? []
  const downstreamBooks = downstreamIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b))
  const missingDownstreamIds = downstreamIds.filter(
    (id) => !books.some((b) => b.id === id)
  )

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [grouping, setGrouping] = useState(false)
  const [groupSel, setGroupSel] = useState<Set<string>>(new Set())

  const prereqBooks = prereqIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b))
  const missingIds = prereqIds.filter((id) => !books.some((b) => b.id === id))

  const inAnyGroup = useMemo(() => new Set(groups.flat()), [groups])

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return books
      .filter((b) => b.id !== bookId)
      .filter((b) => !prereqIds.includes(b.id))
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      .slice(0, 12)
  }, [books, bookId, prereqIds, pickerQuery])

  function nameOf(id: string): string {
    return prereqBooks.find((b) => b.id === id)?.title ?? id
  }

  async function persist(next: {
    prerequisites: string[]
    rule: UnlockRule
    threshold?: number
    groups?: string[][]
  }): Promise<void> {
    const others = edges.filter((e) => e.to !== bookId)
    const hasGroups = (next.groups?.length ?? 0) > 0
    const newEdge: Edge | null =
      next.prerequisites.length === 0 && !hasGroups && next.rule === 'all'
        ? null
        : {
            to: bookId,
            prerequisites: next.prerequisites,
            rule: hasGroups ? 'all' : next.rule,
            ...(hasGroups ? { groups: next.groups } : {}),
            ...(!hasGroups && next.rule === 'any_of'
              ? { threshold: next.threshold ?? next.prerequisites.length }
              : {})
          }
    const updated = newEdge ? [...others, newEdge] : others

    // 写之前做一次环检测 —— 必须与 Rust 后端 relations_set 的校验一致：
    // 后端对**任何**环都拒绝写入，renderer 若只拦"当前作品在环上"，会让
    // 已存在的其他环导致每次写盘静默失败（表现为"点了没反应"）。
    const cycles = detectCycles(updated)
    if (cycles.length > 0) {
      const inCycle = cycles.some((c) => c.includes(bookId))
      alert(
        inCycle
          ? '此修改会造成循环依赖，请先调整其他前置。'
          : '数据中已存在循环依赖（与本次修改无关），请先修复关系图后再保存。'
      )
      return
    }
    // 不变量告警（只警告，不阻止保存）：同一个 to 出现多条边会让 computeUnlocked
    // 静默丢弃前置条件。上面的 filter + push 是 upsert 语义，正常不会触发；
    // 这里守的是将来改动这段拼接逻辑时无声引入重复边。详见 @core 的 validate 模块。
    const invariantMsg = formatIssues(validateEdges(updated))
    if (invariantMsg) console.warn('[PrereqEditor]', invariantMsg)
    await setAll(updated)
  }

  async function remove(id: string): Promise<void> {
    // 移除的前置若在组合里，同步从对应组剔除
    const nextGroups = groups
      .map((g) => g.filter((p) => p !== id))
      .filter((g) => g.length > 0)
    await persist({
      prerequisites: prereqIds.filter((p) => p !== id),
      rule,
      threshold,
      groups: nextGroups
    })
  }

  async function add(id: string): Promise<void> {
    setPickerOpen(false)
    setPickerQuery('')
    await persist({
      prerequisites: [...prereqIds, id],
      rule,
      threshold,
      groups
    })
  }

  async function setRule(r: UnlockRule): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: r,
      threshold: r === 'any_of' ? Math.max(1, threshold) : undefined,
      groups
    })
  }

  async function setThreshold(n: number): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: 'any_of',
      threshold: n,
      groups
    })
  }

  async function removeGroup(group: string[]): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule,
      threshold,
      groups: groups.filter((g) => g !== group)
    })
  }

  async function clearGroups(): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: 'all',
      threshold,
      groups: []
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
    const members = prereqIds.filter((id) => groupSel.has(id))
    if (members.length < 2) return
    const dup = members.filter((m) => inAnyGroup.has(m))
    if (dup.length > 0) {
      alert('所选前置里已有成员属于其他组合，请先移除再组合。')
      return
    }
    await persist({
      prerequisites: prereqIds,
      rule,
      threshold,
      groups: [...groups, members]
    })
    cancelGrouping()
  }

  return (
    <section className="detail-prereqs">
      <h3>
        前置依赖 <span className="muted">({prereqIds.length} 部)</span>
      </h3>

      {prereqIds.length > 0 && groups.length === 0 && (
        <div className="rule-row">
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'all'}
              onChange={() => setRule('all')}
            />
            <span>全部完成才解锁</span>
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
              max={prereqIds.length}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(prereqIds.length, Number(e.target.value) || 1)))}
              disabled={rule !== 'any_of'}
              className="threshold-input"
            />
            <span>部解锁</span>
          </label>
        </div>
      )}

      {groups.length > 0 && (
        <p className="rule-hint">
          规则：二选一组合（<strong>{groups.length}</strong> 组）各任选其一，其余前置全部必须完成。
          <button className="link-btn" onClick={() => void clearGroups()} title="清空所有组合，回到整组规则">
            清除组合
          </button>
        </p>
      )}

      {groups.length > 0 && (
        <div className="or-groups">
          {groups.map((group, i) => (
            <div key={i} className="or-group">
              <span className="or-group-label">组合 {i + 1}（任选其一）</span>
              <span className="or-group-members">{group.map(nameOf).join(' 或 ')}</span>
              <button className="or-group-remove" onClick={() => removeGroup(group)} title="移除该组合">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <ul>
        {prereqBooks.map((p) => (
          <li
            key={p.id}
            className={`prereq status-${p.status}${grouping ? ' grouping' : ''}${groupSel.has(p.id) ? ' group-sel' : ''}`}
            onClick={grouping ? () => toggleGroupSel(p.id) : undefined}
          >
            {grouping && (
              <span className={`group-pick${groupSel.has(p.id) ? ' picked' : ''}`}>
                {groupSel.has(p.id) ? '✓' : ''}
              </span>
            )}
            <span className="title" onClick={grouping ? undefined : () => select(p.id)}>{p.title}</span>
            <span className={`status-tag status-${p.status}`}>{STATUS_LABELS[p.status]}</span>
            <button
              className="prereq-remove"
              onClick={() => remove(p.id)}
              title="移除前置"
              disabled={grouping}
            >
              ×
            </button>
          </li>
        ))}
        {missingIds.map((id) => (
          <li key={id} className="prereq prereq-missing">
            <span className="title">{id}</span>
            <span className="muted">未找到</span>
            <button className="prereq-remove" onClick={() => remove(id)}>×</button>
          </li>
        ))}
        {prereqIds.length === 0 && <li className="muted empty-hint">无前置 —— 此作品永远解锁</li>}
      </ul>

      {/* 反向视角：完成本作品会直接推动谁解锁。仅显示直接一步可达的邻居 */}
      {(downstreamBooks.length > 0 || missingDownstreamIds.length > 0) && (
        <div className="downstream">
          <h4 className="downstream-title">
            完成后将解锁 <span className="muted">({downstreamIds.length} 部)</span>
          </h4>
          <ul className="downstream-list">
            {downstreamBooks.map((b) => (
              <li
                key={b.id}
                className={`downstream-item status-${b.status}`}
                onClick={() => select(b.id)}
              >
                <span className="title">{b.title}</span>
                <span className={`status-tag status-${b.status}`}>{STATUS_LABELS[b.status]}</span>
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
          <button className="add-prereq" onClick={enterGrouping} disabled={prereqIds.length < 2} title="把 2 个及以上前置组成『任选其一』的组合">
            ⚑ 组合二选一
          </button>
        ) : (
          <span className="group-bar">
            <span className="muted">已选 {groupSel.size} 个（至少 2 个）</span>
            <button className="btn-primary" onClick={() => void confirmGroup()} disabled={groupSel.size < 2}>
              确定组合
            </button>
            <button className="btn-secondary" onClick={cancelGrouping}>
              取消
            </button>
          </span>
        )}
      </div>

      {pickerOpen && (
        <div className="prereq-picker">
          <input
            type="search"
            placeholder="搜索作品名 / 作者..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
          />
          <ul>
            {candidates.length === 0 ? (
              <li className="muted">无匹配</li>
            ) : (
              candidates.map((b) => (
                <li key={b.id} onClick={() => add(b.id)}>
                  <span className="title">{b.title}</span>
                  <span className="author muted">{b.author}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
