// Tauri renderer API shim —— 1:1 桥接 src-tauri/src/commands.rs 的 #[tauri::command].
//
// 与 src/shared/api.ts 的 TrackerAPI 形状一致,这样 renderer 代码切换时
// 调用点形态不变(只把 `window.electron.x.y` 换成 `api.x.y`)。
//
// 额外多了 `app.ensureDataDir()`,对应 src-tauri/src/lib.rs 里的
// `app_ensure_data_dir` 命令 —— 给首启 picker 流程用:
//   1. api.app.ensureDataDir()    → 已有则返回;没有则抛错
//   2. catch → api.data.pickDir()  → 用户选/取消
//   3. 成功后再 api.config.get() / api.goals.list() / api.relations.get()
//
// invoke 参数约定(Tauri 2 默认):单个对象,key 用 snake_case,匹配 Rust 函数形参名.

import { invoke } from '@tauri-apps/api/core'
import type { Goal, GoalInput, Config, Edge } from '@shared/types'
import type { BrokenEntry, TrackerAPI, TrashEntry } from '@shared/api'

export const api: TrackerAPI & {
  app: {
    ensureDataDir: () => Promise<string>
  }
} = {
  goals: {
    list: () => invoke<{ goals: Goal[]; broken: BrokenEntry[] }>('goals_list'),
    get: (id) => invoke<Goal | null>('goals_get', { id }),
    create: (input) => invoke<Goal>('goals_create', { input }),
    update: (id, patch) => invoke<Goal>('goals_update', { id, patch }),
    progressBump: (id, delta) => invoke<Goal>('goals_progress_bump', { id, delta }),
    delete: (id) => invoke<void>('goals_delete', { id })
  },
  relations: {
    get: () => invoke<Edge[]>('relations_get'),
    set: (edges) => invoke<void>('relations_set', { edges })
  },
  config: {
    get: () => invoke<Config>('config_get'),
    set: (patch) => invoke<Config>('config_set', { patch })
  },
  data: {
    pickDir: () => invoke<string | null>('data_pick_dir'),
    revealInExplorer: () => invoke<void>('data_reveal_in_explorer')
  },
  trash: {
    list: () => invoke<TrashEntry[]>('trash_list'),
    restore: (id, deletedAt) => invoke<Goal>('trash_restore', { id, deletedAt }),
    purge: (id, deletedAt) => invoke<void>('trash_purge', { id, deletedAt }),
    empty: () => invoke<number>('trash_empty')
  },
  app: {
    ensureDataDir: () => invoke<string>('app_ensure_data_dir')
  }
}
