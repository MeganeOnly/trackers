// 应用层 done 谓词改写 —— 把所有 ExcludeSpec 应用到基础 done map。
//
// 调用时机：在调用 `computeUnlocked` / `compute_unlocked` **之前**，先拿到
// `collectExcludes(edges)` 与原始 done map，再用本模块生成改写后的谓词。
//
// 这层写在 `shared/`（不是 renderer/）是因为 service（Rust 端 service/relations.rs）
// 与 renderer store（selectors.ts）两侧都要复用同一份『改写规则』语义。
// 真正的 Rust 镜像在 `apps/life-tracker/src-tauri/src/service/relations.rs`。

import { collectExcludes } from '@core'
import type { Edge, ExcludeSpec, Goal } from '@shared/types'
import { isGoalDone } from '@shared/types'

/**
 * 给一组 goals + edges，构造改写后的 done 谓词。
 * - 基础谓词：isGoalDone（status==='done' || progress 已满）
 * - 应用每条 ExcludeSpec：
 *   - effect === 'disqualifies' 且 trigger.done → target 视为未 done
 *   - effect === 'satisfies' 且 trigger.done → target 视为已 done
 *
 * 返回 (predicate, excludes) —— predicate 是给 computeUnlocked 用的；
 * excludes 暴露给 UI 用于渲染『互斥规则栏』。
 */
export function buildDonePredicate(
  goals: readonly Goal[],
  edges: readonly Edge[]
): {
  isDone: (id: string) => boolean
  excludes: ExcludeSpec[]
} {
  const goalById = new Map(goals.map((g) => [g.id, g]))
  const rawDone = new Map<string, boolean>()
  for (const g of goals) rawDone.set(g.id, isGoalDone(g))

  const excludes = collectExcludes(edges as Edge[])

  // 收集所有改写条目（去重：同一 target 只接受最后一次改写）
  const overrides = new Map<string, boolean>()
  for (const ex of excludes) {
    if (!rawDone.get(ex.trigger)) continue
    overrides.set(ex.target, ex.effect === 'satisfies')
  }

  return {
    isDone: (id: string): boolean => {
      if (overrides.has(id)) return overrides.get(id)!
      const g = goalById.get(id)
      return g ? isGoalDone(g) : false
    },
    excludes
  }
}