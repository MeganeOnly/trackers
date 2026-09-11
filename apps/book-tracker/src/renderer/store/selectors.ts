import { useMemo } from 'react'
import { useBooksStore } from './books'
import { useRelationsStore } from './relations'
import { computeBlockingRelations, computeUnlocked } from '@core'
import type { BlockingRelation } from '@core'
import type { Book, EpisodeNotes, EpisodeRecord, SeasonInfo } from '@shared/types'
import { episodeKey, isBookDone } from '@shared/types'

export function useUnlocked(): {
  unlocked: Map<string, boolean>
  cycles: string[][]
  /** 每个 id 的直接双向邻居：blocks（我解锁后能推动谁）/ blockedBy（还卡在谁上） */
  relations: Map<string, BlockingRelation>
} {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  // book-tracker 没有 countable 任务 —— 引用次数参数直接忽略
  const unlocked = computeUnlocked(
    books.map((b) => b.id),
    edges,
    (id, _requiredCount) => books.some((b) => b.id === id && isBookDone(b))
  )
  // 与 unlock 同步算 —— 同样的 edges 输入,O(E) 一次扫描
  const relations = useMemo(() => computeBlockingRelations(edges), [edges])
  return { ...unlocked, relations }
}

export function useGroupedByStatus(): Record<Book['status'], Book[]> {
  const books = useBooksStore((s) => s.books)
  const groups: Record<Book['status'], Book[]> = {
    want: [],
    shelved: [],
    reading: [],
    watching: [],
    finished: [],
    abandoned: []
  }
  for (const b of books) groups[b.status].push(b)
  for (const k of Object.keys(groups) as Book['status'][]) {
    groups[k].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }
  return groups
}

// ==================== v1.2 集笔记 selectors ====================

/**
 * 取作品的季信息数组(已按季号升序)。
 * 无 seasons 字段 → 返回 `[{ number: 1, episodeCount: progress.total ?? 0 }]`(单季剧兜底)。
 */
export function useSeasonsForBook(bookId: string | null | undefined): SeasonInfo[] {
  const book = useBooksStore((s) => (bookId ? s.books.find((b) => b.id === bookId) : undefined))
  return useMemo(() => {
    if (!book) return []
    const seasons = book.seasons && book.seasons.length > 0 ? book.seasons : null
    if (seasons) {
      return [...seasons].sort((a, b) => a.number - b.number)
    }
    // 兜底:单季剧,用 progress.total 或 0 当集数
    const total = book.progress?.total ?? 0
    return [{ number: 1, episodeCount: total, notes: undefined }]
  }, [book?.seasons, book?.progress?.total])
}

/** 取作品的单集稀疏 map(undefined → 空对象,组件内省去空判断) */
export function useEpisodesForBook(bookId: string | null | undefined): EpisodeNotes {
  const book = useBooksStore((s) => (bookId ? s.books.find((b) => b.id === bookId) : undefined))
  return useMemo(() => book?.episodes ?? {}, [book?.episodes])
}

/** 取单集记录(无 key → undefined,组件内省去空判断) */
export function useEpisodeFor(
  bookId: string | null | undefined,
  season: number,
  episode: number
): EpisodeRecord | undefined {
  const episodes = useEpisodesForBook(bookId)
  return episodes[episodeKey(season, episode)]
}

/**
 * 集笔记统计 —— 一次扫描算 4 个数(避免每渲染都重算)。
 * - totalEpisodes: 全剧总集数(seasons 总和)
 * - watchedCount: 已看集数
 * - noteCount: 有 note 的集数
 * - titleCount: 有 title 的集数
 */
export interface EpisodeStats {
  totalEpisodes: number
  watchedCount: number
  noteCount: number
  titleCount: number
}

export function useEpisodeStats(bookId: string | null | undefined): EpisodeStats {
  const book = useBooksStore((s) => (bookId ? s.books.find((b) => b.id === bookId) : undefined))
  return useMemo(() => {
    const stats: EpisodeStats = { totalEpisodes: 0, watchedCount: 0, noteCount: 0, titleCount: 0 }
    if (!book) return stats
    const seasons = book.seasons && book.seasons.length > 0 ? book.seasons : null
    if (seasons) {
      stats.totalEpisodes = seasons.reduce((s, x) => s + x.episodeCount, 0)
    } else {
      stats.totalEpisodes = book.progress?.total ?? 0
    }
    const eps = book.episodes
    if (!eps) return stats
    for (const rec of Object.values(eps)) {
      if (rec.watched) stats.watchedCount += 1
      if (rec.note.trim().length > 0) stats.noteCount += 1
      if (rec.title && rec.title.trim().length > 0) stats.titleCount += 1
    }
    return stats
  }, [book?.seasons, book?.progress?.total, book?.episodes])
}
