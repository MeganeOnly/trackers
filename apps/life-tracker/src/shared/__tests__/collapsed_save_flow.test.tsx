// 端到端 regression：用户在 GoalDetail 勾选「侧栏收起」+ 保存后，
// 实际经过 `useGoalsStore.update` → `api.goals.update` →
// `invoke<Goal>('goals_update', { id, patch })` 这条链路，
// 确认 patch.collapsed 被 invoke 正确发出，且 store 收到更新后的 goal 后
// goal.collapsed === true（之后再切到别的目标、再切回来，checkbox 仍应是 checked）。
//
// 用户复测反馈"勾选什么也没发生、切走再回来勾选也没了"——
// 这次让我们用 vitest + @testing-library/react 真实模拟：渲染 GoalDetail、
// 模拟点击 checkbox、模拟点击保存按钮、断言 store 与 invoke。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Goal } from '@shared/types'

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
}))
vi.mock('@/components/PrereqEditor', () => ({
  PrereqEditor: () => null
}))

const { useGoalsStore } = await import('@/store/goals')
const { GoalDetail } = await import('@/components/GoalDetail')

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: '1',
    title: '国奖',
    note: '',
    category: '',
    deadline: null,
    status: 'in_progress',
    progress: null,
    countable: false,
    pinned: false,
    hidden: false,
    collapsed: false,
    created: '2026-08-28T00:00:00Z',
    updated: '2026-08-28T00:00:00Z',
    ...over
  } as Goal
}

describe('GoalDetail 完整点击流程：勾侧栏收起 + 保存 → store.collapsed=true', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    useGoalsStore.setState({
      goals: [makeGoal({ id: '1', title: '国奖' })],
      broken: [],
      selectedId: '1',
      loading: false
    })
  })

  afterEach(() => {
    cleanup()
    invokeMock.mockReset()
  })

  it('模拟用户完整点击 → invoke 收到 patch.collapsed=true, store goal.collapsed=true', async () => {
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'goals_update') {
        const { id, patch } = args as { id: string; patch: { collapsed?: boolean; [k: string]: unknown } }
        const updated: Goal = makeGoal({
          id,
          title: '国奖',
          collapsed: patch.collapsed ?? false,
          pinned: (patch.pinned as boolean) ?? false,
          hidden: (patch.hidden as boolean) ?? false,
          countable: (patch.countable as boolean) ?? false,
          status: (patch.status as Goal['status']) ?? 'in_progress'
        })
        return Promise.resolve(updated)
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`))
    })

    render(<GoalDetail />)
    const collLabel = screen.getByText('侧栏收起').closest('label')!
    const checkbox = collLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    const user = userEvent.setup()
    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)

    const saveBtn = screen.getByRole('button', { name: /保存/ })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled()
    })

    const [cmd, payload] = invokeMock.mock.calls.at(-1)!
    expect(cmd).toBe('goals_update')
    expect(payload).toMatchObject({
      id: '1',
      patch: { collapsed: true }
    })

    await waitFor(() => {
      const g = useGoalsStore.getState().goals.find((g) => g.id === '1')!
      expect(g.collapsed).toBe(true)
    })
  })

  it('保存后切到别的目标再切回来，checkbox 应为 checked（这是用户报告的那个场景）', async () => {
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === 'goals_update') {
        const { id, patch } = args as { id: string; patch: { collapsed?: boolean } }
        return Promise.resolve(makeGoal({ id, title: '国奖', collapsed: patch.collapsed ?? false }))
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`))
    })

    useGoalsStore.setState({
      goals: [makeGoal({ id: '1', title: '国奖' }), makeGoal({ id: '2', title: '其它目标' })],
      broken: [],
      selectedId: '1',
      loading: false
    })

    render(<GoalDetail />)
    const user = userEvent.setup()

    // 1. 勾「侧栏收起」+ 保存
    const collLabel = screen.getByText('侧栏收起').closest('label')!
    const collChk = collLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(collChk)
    expect(collChk.checked).toBe(true)
    await user.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      const g = useGoalsStore.getState().goals.find((g) => g.id === '1')!
      expect(g.collapsed).toBe(true)
    })

    // 2. 切到目标 2
    useGoalsStore.getState().select('2')

    await waitFor(() => {
      const collLabel2 = screen.getByText('侧栏收起').closest('label')!
      const collChk2 = collLabel2.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(collChk2.checked).toBe(false)
    })

    // 3. 切回目标 1 —— 这是用户报告"勾选也没了"的位置
    useGoalsStore.getState().select('1')

    await waitFor(() => {
      const collLabelBack = screen.getByText('侧栏收起').closest('label')!
      const collChkBack = collLabelBack.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(collChkBack.checked).toBe(true)
    })
  })
})
