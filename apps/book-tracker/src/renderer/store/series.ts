import { create } from 'zustand'
import { api } from '../lib/api'
import type { Series, SeriesInput, SeriesPatch } from '@shared/types'

/**
 * v1.7 系列 store —— 跟 relations / books 同款独立 store(每个领域一个文件)。
 *
 * **数据来源**:series 本身(元信息) + 各 book 的 seriesId(成员关系)。
 * store 只存 series 列表;成员关系走 books store(因为 book 列表本来就常驻)。
 * 系列详情 modal 用 `booksInSeries()` 派生函数从 books store 取成员。
 */
interface SeriesState {
  series: Series[]
  loading: boolean
  /** 读所有 series。首启 + SeriesModal 打开时调 */
  load: () => Promise<void>
  /** 创建新 series。name 必填 —— 前端先校验,后端 service 再兜底 */
  create: (input: SeriesInput) => Promise<Series>
  /** 更新 series。name 必填校验同上 */
  update: (id: string, patch: SeriesPatch) => Promise<Series>
  /** 删除 series。联动清理所有 books 的 seriesId 引用(Rust 端兜底) */
  remove: (id: string) => Promise<void>
  /**
   * 清除指向已删除 series 的 book 引用 —— 后端虽然已经清过,但前端 books store
   * 里的数据可能已经展示了"原系列已删除"提示;调一下让前端状态同步刷新。
   *
   * 这里**不**直接调用 IPC(避免 IPC 路径重复清理);由组件在 `remove()` 后
   * 主动调 `useBooksStore.getState().load()` 整体 reload 即可(数量小,几百本以内)。
   * 当前函数保留作占位,便于将来按需扩展为局部更新(避免 reload 全量)。
   */
  // 留作扩展位
}

export const useSeriesStore = create<SeriesState>((set) => ({
  series: [],
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const series = await api.series.list()
      set({ series, loading: false })
    } catch (e) {
      console.error('series load failed:', e)
      set({ loading: false })
    }
  },
  create: async (input) => {
    if (!input.name.trim()) {
      throw new Error('系列名不能为空')
    }
    const series = await api.series.create(input)
    set((s) => ({ series: [...s.series, series] }))
    return series
  },
  update: async (id, patch) => {
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new Error('系列名不能为空')
    }
    const updated = await api.series.update(id, patch)
    set((s) => ({
      series: s.series.map((x) => (x.id === id ? updated : x))
    }))
    return updated
  },
  remove: async (id) => {
    await api.series.delete(id)
    set((s) => ({ series: s.series.filter((x) => x.id !== id) }))
  }
}))