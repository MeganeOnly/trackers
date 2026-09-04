// 作品双链 `[[角色名]]` —— 渲染组件
//
// 用途:把一段含 `[[xxx]]` 的纯文本渲染成「可点击的 wikilink + 普通文本」混合片段。
//
// 视觉(由 status 决定 className,样式在 styles.css):
// - `local`:主题色 + hover 下划线;点击 → useWikilink().navigateLocal(bookId, characterId)
// - `global-unique`:同上 + 角标 `↗`;点击 → navigateGlobal(targetBookId, characterId)
// - `global-multi`:同上 + `· N处` + 角标;点击 → useWikilink().openGlobalPicker(...)
// - `broken`:红色虚线下划线;点击 → useWikilink().openCreate({bookId, target})
//
// 性能:resolveWikilink 在每次渲染时对每个 wikilink 跑一次 —— 用 useMemo 按
// (segments 长度, allBooks 引用, currentBook.id) 缓存整张 segments 解析结果,
// 避免 100+ wikilink 笔记反复扫全作品列表。
//
// 安全:文本节点用 React 默认 escape,无 dangerouslySetInnerHTML。

import { memo, useMemo } from 'react'
import type { Book } from '@shared/types'
import { resolveWikilink, splitWikilinkSegments, type WikilinkSegment } from '@shared/wikilink'
import { useWikilink } from './WikilinkContext'

interface WikilinkTextProps {
  /** 含 `[[xxx]]` 的原始文本(从 Book.notes / Character.notes 等取) */
  text: string
  /** 当前笔记所属的作品(local 解析用) */
  currentBook: Book
  /** 全作品列表(cross-book 兜底用) */
  allBooks: Book[]
  /** 预览容器 className(自定义高度 / 边距) */
  className?: string
  /**
   * 是否允许点击 → 默认 true;TimeStamp 行内预览场景可以设 false 避免误触。
   * 设为 false 时 wikilink 渲染成只读 span,不响应 click。
   */
  interactive?: boolean
}

function WikilinkTextImpl({
  text,
  currentBook,
  allBooks,
  className,
  interactive = true
}: WikilinkTextProps): JSX.Element {
  const wikilink = useWikilink()

  // 切分 + 解析缓存
  const rendered = useMemo(() => {
    const segments = splitWikilinkSegments(text)
    return segments.map((seg, idx) => {
      if (seg.kind === 'plain') {
        // 保留内部换行,React 自动处理 whitespace
        return <span key={idx}>{seg.text}</span>
      }
      // wikilink 段
      const resolved = resolveWikilink(seg.target, { currentBook, allBooks })
      return (
        <WikilinkSpan
          key={idx}
          segment={seg}
          resolved={resolved}
          currentBookId={currentBook.id}
          interactive={interactive}
          onNavigateLocal={wikilink.navigateLocal}
          onNavigateGlobal={wikilink.navigateGlobal}
          onPickGlobal={wikilink.openGlobalPicker}
          onCreateBroken={wikilink.openCreate}
        />
      )
    })
  }, [text, currentBook, allBooks, interactive, wikilink])

  return (
    <div className={className ?? 'wikilink-preview'} aria-label="笔记预览(含 wikilink)">
      {rendered.length > 0 ? rendered : <span className="muted">(空)</span>}
    </div>
  )
}

interface WikilinkSpanProps {
  segment: Extract<WikilinkSegment, { kind: 'wikilink' }>
  resolved: ReturnType<typeof resolveWikilink>
  currentBookId: string
  interactive: boolean
  onNavigateLocal: (bookId: string, characterId: string) => void
  onNavigateGlobal: (targetBookId: string, characterId: string) => void
  onPickGlobal: (target: string, candidates: import('@shared/wikilink').WikilinkCandidate[]) => void
  onCreateBroken: (req: {
    bookId: string
    target: string
    onCreated: (characterId: string) => void
  }) => void
}

/**
 * 单个 wikilink 片段的渲染 —— 把 resolve 结果映射成 button(可点击)或 span(只读)。
 *
 * class 决定视觉;click handler 决定行为。
 */
function WikilinkSpan({
  segment,
  resolved,
  currentBookId,
  interactive,
  onNavigateLocal,
  onNavigateGlobal,
  onPickGlobal,
  onCreateBroken
}: WikilinkSpanProps): JSX.Element {
  const target = segment.target
  // 决定样式类
  let cls = 'wikilink'
  let titleText = ''
  let display: string = target
  switch (resolved.status) {
    case 'local':
      cls += ' wikilink-resolved'
      titleText = `跳到「${target}」的角色笔记`
      break
    case 'global-unique':
      cls += ' wikilink-resolved wikilink-global'
      titleText = `跳到《${resolved.sourceBook?.title ?? '?'}》的「${target}」`
      display = `${target} ↗`
      break
    case 'global-multi':
      cls += ' wikilink-resolved wikilink-multi'
      titleText = `「${target}」在 ${resolved.candidates?.length ?? 0} 处存在 —— 点击选择`
      display = `${target} · ${resolved.candidates?.length ?? 0}处 ↗`
      break
    case 'broken':
      cls += ' wikilink-broken'
      titleText = `「${target}」不存在 —— 点击创建`
      display = `[[${target}]]`
      break
  }

  if (!interactive) {
    return (
      <span className={cls} title={titleText}>
        {display}
      </span>
    )
  }

  function handleClick(): void {
    switch (resolved.status) {
      case 'local':
        if (resolved.character) {
          onNavigateLocal(currentBookId, resolved.character.id)
        }
        return
      case 'global-unique':
        if (resolved.character && resolved.sourceBook) {
          onNavigateGlobal(resolved.sourceBook.id, resolved.character.id)
        }
        return
      case 'global-multi':
        if (resolved.candidates) {
          onPickGlobal(target, resolved.candidates)
        }
        return
      case 'broken':
        onCreateBroken({
          bookId: currentBookId,
          target,
          onCreated: (characterId) => {
            // 创建完直接跳过去 —— 让用户立刻看到新角色已就位
            onNavigateLocal(currentBookId, characterId)
          }
        })
        return
    }
  }

  return (
    <button type="button" className={cls} title={titleText} onClick={handleClick}>
      {display}
    </button>
  )
}

/** memo 包装 —— 父组件重渲染时若 text / currentBook / allBooks 不变就不重渲。 */
export const WikilinkText = memo(WikilinkTextImpl)
