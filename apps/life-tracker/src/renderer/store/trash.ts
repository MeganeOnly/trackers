// 回收站 store —— 列出 / 还原 / 永久删除 / 清空。
//
// 与 goals store 解耦：回收站条目是"已删除"目标的元数据快照，不参与
// computeUnlocked / CleanMode / EditMode 任何渲染；restore 时把 Goal 推回
// goals store（外部调用方做），purge / empty 只动 trash 自身。

import { create } from 'zustand'
import { api } from '../lib/api'
import type { TrashEntry } from '@shared/api'
import type { Goal } from '@shared/types'

interface TrashState {
  entries: TrashEntry[]
  loading: boolean
  /** 上次 restore / purge / empty 的错误（UI 展示用，不阻塞后续操作） */
  error: string | null
  load: () => Promise<void>
  restore: (id: string, deletedAt: number) => Promise<Goal>
  purge: (id: string, deletedAt: number) => Promise<void>
  empty: () => Promise<number>
}

export const useTrashStore = create<TrashState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const entries = await api.trash.list()
      set({ entries, loading: false })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },
  restore: async (id, deletedAt) => {
    const goal = await api.trash.restore(id, deletedAt)
    // 本地 entries 列表移除（按 (id, deletedAt) 精确匹配）
    set((s) => ({
      entries: s.entries.filter((e) => !(e.goal_id === id && e.deleted_at === deletedAt))
    }))
    return goal
  },
  purge: async (id, deletedAt) => {
    await api.trash.purge(id, deletedAt)
    set((s) => ({
      entries: s.entries.filter((e) => !(e.goal_id === id && e.deleted_at === deletedAt))
    }))
  },
  empty: async () => {
    const n = await api.trash.empty()
    set({ entries: [] })
    return n
  }
}))

/** 同步从 store 读当前 entries 数（无订阅，避免不必要的 re-render）。 */
export function trashCount(): number {
  return useTrashStore.getState().entries.length
}
