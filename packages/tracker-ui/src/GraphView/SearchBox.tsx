// packages/tracker-ui/src/GraphView/SearchBox.tsx
//
// 关系图搜索框 —— 模糊匹配节点 id / title / tag，命中高亮 + 淡化其它。
//
// 共享层 props：searchQuery / setSearchQuery 由 app 端 useState 管理；
// getNodeSearchText 由 app 端拼装（title + id + tags.join(' ')）。
//
// 视觉规则：
//   - 命中节点：节点大小放大 1.6×（按 refCount 公式 +1），画蓝色 2px 描边
//   - 其它节点：rgba(200,200,200,0.15) 灰淡（react-force-graph nodeColor 直接支持 rgba）
//   - 0 命中：右侧红色"无匹配"提示
//   - Esc 清空搜索
//
// 搜索状态归 app 端 —— 共享层只算 matches + 改渲染。

import { useEffect } from 'react'

interface SearchBoxProps {
  query: string
  setQuery: (q: string) => void
  /** 当前命中数（0 = 无匹配） */
  matchCount: number
}

export function SearchBox({ query, setQuery, matchCount }: SearchBoxProps): JSX.Element {
  // Esc 清空搜索（focus 在 input 上时；其它位置不抢 Esc）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        if ((ae as HTMLElement).classList.contains('graph-search-input')) {
          setQuery('')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setQuery])

  return (
    <div className="graph-search-box">
      <input
        type="text"
        className="graph-search-input"
        placeholder="搜索节点 id / 标题 / 标签"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="搜索节点"
      />
      {query.length > 0 && matchCount === 0 && (
        <span className="graph-search-empty" role="status">
          无匹配
        </span>
      )}
      {query.length > 0 && matchCount > 0 && (
        <span className="graph-search-count" role="status">
          {matchCount}
        </span>
      )}
    </div>
  )
}