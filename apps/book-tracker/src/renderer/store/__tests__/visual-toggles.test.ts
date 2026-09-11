// apps/book-tracker/src/renderer/store/__tests__/visual-toggles.test.ts
//
// 视觉微调开关 —— 独立客观验证整条链路
//
// 用户报告:在 Settings 里点了「本地」和「柔和」之后,UI 没有任何视觉变化。
//
// 这份测试**完全独立于用户 GUI**,客观可重复。三段验证:
//   § 1 用 postcss 解析 packages/tracker-ui/src/base.css —— CSS 选择器 + token 数值
//   § 2 useTheme.applyFontSource / applyCozyTokens / normalizeBool —— DOM 同步正确
//   § 3 mock Tauri invoke 后,从 settings store action 走完整链路 —— store + DOM 都同步
//
// 任何一环断 = bug;全过 = 用户报告在 dev mode 下没看到效果是 DevTools / HMR / 缓存等外部原因。
//
// 不污染现有 __tests__:放进 apps/book-tracker/src/renderer/store/__tests__/,
// 与 settings.ts 同目录;book-tracker vitest.config.ts 的
//   src/renderer/**/*.test.{ts,tsx}   glob 会自动收。

// @vitest-environment jsdom

// 测试需要 Node 类型(fs/path)来读 base.css 文件;web tsconfig 关闭了 @types/node 的
// 全局注入,这里显式 reference。根 package.json 已经把 @types/node 提到 devDep,
// 走的是「Vite alias + ?raw」的 file loader 路径。
/// <reference types="node" />

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'

// =========================================================================
// mock Tauri invoke 必须在 settings.ts import 之前 hoist 完成
// =========================================================================
//
// api.config.set 必须 echo back 用户传的 patch,
// 否则 setUseLocalFonts action 的「stored !== normalized → 强制回滚」分支
// 会把刚写好的 DOM 又改回 remote,导致测试假阳性失败。
// book-tracker/src/renderer/lib/api.ts 的形状见 src/shared/api.ts (TrackerAPI)。
vi.mock('../../lib/api', () => ({
  api: {
    config: {
      set: vi.fn(async (patch: Record<string, unknown>) => ({
        version: 1,
        data_dir: '/fake',
        language: 'zh-CN' as const,
        default_mode: 'clean' as const,
        default_work_kind: 'book' as const,
        works_filter: 'all',
        ...patch
      })),
      get: vi.fn()
    },
    books: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      progressBump: vi.fn(),
      delete: vi.fn(),
      seasonsSet: vi.fn(),
      episodeSetWatched: vi.fn(),
      episodeSetNote: vi.fn(),
      episodeSetTitle: vi.fn(),
      episodesClear: vi.fn(),
      episodeBump: vi.fn(),
      episodeSetStamps: vi.fn(),
      charactersSet: vi.fn(),
      setNextSeason: vi.fn(),
      setSeries: vi.fn()
    },
    relations: { get: vi.fn(), set: vi.fn() },
    ranking: { get: vi.fn(), apply: vi.fn() },
    series: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    candidates: { list: vi.fn(), add: vi.fn(), remove: vi.fn(), promote: vi.fn() },
    data: { pickDir: vi.fn(), revealInExplorer: vi.fn() },
    app: { ensureDataDir: vi.fn() }
  }
}))

// mock 完成后再 import 使用了 mock 的模块
import { applyFontSource, applyCozyTokens, normalizeBool } from '@ui/useTheme'
import type { Config } from '@shared/types'
import { useSettingsStore } from '../settings'
import { api } from '../../lib/api'

// =========================================================================
// 共享工具
// =========================================================================

/** 从 postcss root 找出 selector 匹配的目标 rule(精确匹配其中一个 selector 串)。 */
function findRule(
  root: ReturnType<typeof postcss.parse>,
  selector: string
): ReturnType<typeof postcss.parse>['nodes'] extends Array<infer N>
  ? (N extends { selectors: string[] } ? N : never)
  : never {
  let found: any = null
  root.walkRules((rule: any) => {
    if (rule.selectors.includes(selector)) {
      found = rule
      return false // stop walk
    }
  })
  return found
}

/** 取 rule 内指定 prop 的 declaration value(没有则 undefined)。 */
function getDeclValue(rule: any, prop: string): string | undefined {
  let value: string | undefined
  rule.walkDecls(prop, (decl: any) => {
    value = decl.value
    return false
  })
  return value
}

// =========================================================================
// § 1 base.css 编译产物解析
// =========================================================================

describe('§ 1 base.css 编译产物解析', () => {
  // __dirname = apps/book-tracker/src/renderer/store/__tests__
  // 上溯 6 层到 repo 根 + packages/tracker-ui/src/base.css
  const cssPath = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'tracker-ui',
    'src',
    'base.css'
  )
  let root: ReturnType<typeof postcss.parse>

  beforeAll(() => {
    const css = readFileSync(cssPath, 'utf-8')
    root = postcss.parse(css)
  })

  it('1.1 文件存在且能被 postcss 解析', () => {
    expect(root, 'postcss.parse 应返回非空 root').toBeTruthy()
    // 解析后至少包含一些 rule / atrule 节点
    let count = 0
    root.walk(() => {
      count++
    })
    expect(count).toBeGreaterThan(0)
  })

  it('1.2 存在 :root[data-font-source="local"] 规则,且 override --font-display-loaded', () => {
    const rule = findRule(root, ':root[data-font-source="local"]')
    expect(rule, '应能找到 :root[data-font-source="local"] rule').toBeTruthy()

    const fontDisplayLoaded = getDeclValue(rule, '--font-display-loaded')
    expect(
      fontDisplayLoaded,
      '--font-display-loaded override 应存在'
    ).toBeDefined()
    expect(
      fontDisplayLoaded,
      '--font-display-loaded 应包含 "Fraunces Local" 让 classic 切 ON 也能看到'
    ).toContain("'Fraunces Local'")

    // 顺便验 --font-display 也在(classic 没 preset override 时插队)
    const fontDisplay = getDeclValue(rule, '--font-display')
    expect(
      fontDisplay,
      '--font-display override 也应在(classic 走 var(--font-display))'
    ).toContain("'Fraunces Local'")
  })

  it('1.3 存在 :root[data-cozy-tokens="on"] 规则,token 数值是改大后的', () => {
    const rule = findRule(root, ':root[data-cozy-tokens="on"]')
    expect(rule, '应能找到 :root[data-cozy-tokens="on"] rule').toBeTruthy()

    // radius-md 4 → 8
    expect(getDeclValue(rule, '--radius-md')).toBe('8px')
    // radius-sm 2 → 4
    expect(getDeclValue(rule, '--radius-sm')).toBe('4px')
    // radius-lg 8 → 12
    expect(getDeclValue(rule, '--radius-lg')).toBe('12px')
    // spacing s-4 16 → 18
    expect(getDeclValue(rule, '--s-4')).toBe('18px')
    // spacing s-3 12 → 14
    expect(getDeclValue(rule, '--s-3')).toBe('14px')
    // spacing s-6 24 → 28
    expect(getDeclValue(rule, '--s-6')).toBe('28px')
    // shadow-card 改成更柔的 0 8px 24px
    const shadow = getDeclValue(rule, '--shadow-card')
    expect(shadow).toBe('0 8px 24px rgba(0, 0, 0, 0.06)')
  })

  it('1.4 存在 6 条 @font-face "Fraunces Local" 规则(400/500/600/700 normal + 400/600 italic)', () => {
    const faceMatches: string[] = []
    root.walkAtRules('font-face', (at: any) => {
      let family: string | undefined
      at.walkDecls('font-family', (decl: any) => {
        family = decl.value
      })
      if (family === "'Fraunces Local'") {
        let weight: string | undefined
        let style: string | undefined
        at.walkDecls('font-weight', (d: any) => {
          weight = d.value
        })
        at.walkDecls('font-style', (d: any) => {
          style = d.value
        })
        faceMatches.push(`${weight ?? '?'}-${style ?? '?'}`)
      }
    })

    expect(faceMatches.length).toBe(6)
    expect(faceMatches).toEqual(
      expect.arrayContaining([
        '400-normal',
        '500-normal',
        '600-normal',
        '700-normal',
        '400-italic',
        '600-italic'
      ])
    )
  })
})

// =========================================================================
// § 2 useTheme.ts —— 纯函数 DOM 同步
// =========================================================================

describe('§ 2 useTheme applyFontSource / applyCozyTokens / normalizeBool', () => {
  beforeEach(() => {
    // 每次清空,避免测试间污染
    delete document.documentElement.dataset.fontSource
    delete document.documentElement.dataset.cozyTokens
  })

  describe('normalizeBool', () => {
    it('2.1 normalizeBool(true) === true', () => {
      expect(normalizeBool(true)).toBe(true)
    })
    it('2.2 normalizeBool(undefined) === false', () => {
      expect(normalizeBool(undefined)).toBe(false)
    })
    it('2.3 normalizeBool("yes") === false(字符串非 true)', () => {
      expect(normalizeBool('yes')).toBe(false)
    })
    it('2.4 normalizeBool(0) === false', () => {
      expect(normalizeBool(0)).toBe(false)
    })
    it('2.5 normalizeBool(1) === false(数字非 true)', () => {
      expect(normalizeBool(1)).toBe(false)
    })
    it('2.6 normalizeBool(null / false / "" / "true") 全部 === false', () => {
      expect(normalizeBool(null)).toBe(false)
      expect(normalizeBool(false)).toBe(false)
      expect(normalizeBool('')).toBe(false)
      expect(normalizeBool('true')).toBe(false)
    })
  })

  describe('applyFontSource', () => {
    it('2.7 applyFontSource(true) 写 dataset.fontSource = "local"', () => {
      applyFontSource(true)
      expect(document.documentElement.dataset.fontSource).toBe('local')
    })
    it('2.8 applyFontSource(false) 也写 attribute = "remote"(OFF 不依赖"未设置 = 默认")', () => {
      applyFontSource(false)
      expect(document.documentElement.dataset.fontSource).toBe('remote')
    })
    it('2.9 幂等:连续两次 applyFontSource(true) 后仍是 "local"', () => {
      applyFontSource(true)
      applyFontSource(true)
      expect(document.documentElement.dataset.fontSource).toBe('local')
    })
    it('2.10 切换:true → false 后 dataset 是 "remote"', () => {
      applyFontSource(true)
      expect(document.documentElement.dataset.fontSource).toBe('local')
      applyFontSource(false)
      expect(document.documentElement.dataset.fontSource).toBe('remote')
    })
  })

  describe('applyCozyTokens', () => {
    it('2.11 applyCozyTokens(true) 写 dataset.cozyTokens = "on"', () => {
      applyCozyTokens(true)
      expect(document.documentElement.dataset.cozyTokens).toBe('on')
    })
    it('2.12 applyCozyTokens(false) 写 dataset.cozyTokens = "off"', () => {
      applyCozyTokens(false)
      expect(document.documentElement.dataset.cozyTokens).toBe('off')
    })
    it('2.13 切换:false → true 后 dataset 是 "on"', () => {
      applyCozyTokens(false)
      applyCozyTokens(true)
      expect(document.documentElement.dataset.cozyTokens).toBe('on')
    })
  })
})

// =========================================================================
// § 3 settings store —— 完整链路 store action → DOM
// =========================================================================

describe('§ 3 settings store action → DOM 同步(端到端)', () => {
  beforeEach(() => {
    // 重置 store state 到初值
    useSettingsStore.setState({
      defaultWorkKind: 'book',
      worksFilter: 'all',
      theme: 'classic',
      format: 'list',
      sidebarSeriesEntryMode: 'inline-row',
      useLocalFonts: false,
      useCozyTokens: false
    })
    // 重置 DOM attribute
    delete document.documentElement.dataset.fontSource
    delete document.documentElement.dataset.cozyTokens
    // 重置 mock 调用记录
    vi.mocked(api.config.set).mockClear()
  })

  it('3.1 setUseLocalFonts(true) 同步 DOM 与 store', async () => {
    await useSettingsStore.getState().setUseLocalFonts(true)

    expect(document.documentElement.dataset.fontSource).toBe('local')
    expect(useSettingsStore.getState().useLocalFonts).toBe(true)
    expect(api.config.set).toHaveBeenCalledWith({ use_local_fonts: true })
  })

  it('3.2 setUseLocalFonts(false) 把 DOM 改回 "remote"(OFF 路径)', async () => {
    await useSettingsStore.getState().setUseLocalFonts(true)
    expect(document.documentElement.dataset.fontSource).toBe('local')

    await useSettingsStore.getState().setUseLocalFonts(false)
    expect(document.documentElement.dataset.fontSource).toBe('remote')
    expect(useSettingsStore.getState().useLocalFonts).toBe(false)
  })

  it('3.3 setUseCozyTokens(true) 同步 DOM 与 store', async () => {
    await useSettingsStore.getState().setUseCozyTokens(true)

    expect(document.documentElement.dataset.cozyTokens).toBe('on')
    expect(useSettingsStore.getState().useCozyTokens).toBe(true)
    expect(api.config.set).toHaveBeenCalledWith({ use_cozy_tokens: true })
  })

  it('3.4 setUseCozyTokens(false) 把 DOM 改回 "off"', async () => {
    await useSettingsStore.getState().setUseCozyTokens(true)
    await useSettingsStore.getState().setUseCozyTokens(false)

    expect(document.documentElement.dataset.cozyTokens).toBe('off')
    expect(useSettingsStore.getState().useCozyTokens).toBe(false)
  })

  it('3.5 两个开关同时 ON,DOM 同时有两个 attribute', async () => {
    await useSettingsStore.getState().setUseLocalFonts(true)
    await useSettingsStore.getState().setUseCozyTokens(true)

    expect(document.documentElement.dataset.fontSource).toBe('local')
    expect(document.documentElement.dataset.cozyTokens).toBe('on')
    expect(useSettingsStore.getState().useLocalFonts).toBe(true)
    expect(useSettingsStore.getState().useCozyTokens).toBe(true)
  })

  it('3.6 hydrate(fakeConfig with use_local_fonts/use_cozy_tokens=true) 也同步 DOM', async () => {
    const cfg: Config = {
      version: 1,
      data_dir: '/fake',
      language: 'zh-CN',
      default_mode: 'clean',
      default_work_kind: 'book',
      works_filter: 'all',
      theme: 'classic',
      format: 'list',
      sidebar_series_entry_mode: 'inline-row',
      use_local_fonts: true,
      use_cozy_tokens: true
    }
    useSettingsStore.getState().hydrate(cfg)

    // hydrate 内部 applyFontSource / applyCozyTokens 是同步的(不调 invoke)
    expect(document.documentElement.dataset.fontSource).toBe('local')
    expect(document.documentElement.dataset.cozyTokens).toBe('on')
    expect(useSettingsStore.getState().useLocalFonts).toBe(true)
    expect(useSettingsStore.getState().useCozyTokens).toBe(true)
  })

  it('3.7 hydrate 缺字段(undefined) → 默认 false,DOM 写 "remote" / "off"', () => {
    const cfg: Config = {
      version: 1,
      data_dir: '/fake',
      language: 'zh-CN',
      default_mode: 'clean',
      default_work_kind: 'book',
      works_filter: 'all'
      // use_local_fonts / use_cozy_tokens 不给
    }
    useSettingsStore.getState().hydrate(cfg)

    expect(document.documentElement.dataset.fontSource).toBe('remote')
    expect(document.documentElement.dataset.cozyTokens).toBe('off')
    expect(useSettingsStore.getState().useLocalFonts).toBe(false)
    expect(useSettingsStore.getState().useCozyTokens).toBe(false)
  })

  it('3.8 hydrate 垃圾值("yes" / 1 / 0) → normalizeBool 全 false', () => {
    const cfg = {
      version: 1,
      data_dir: '/fake',
      language: 'zh-CN' as const,
      default_mode: 'clean' as const,
      default_work_kind: 'book' as const,
      works_filter: 'all',
      // 故意传垃圾值,模拟老 config.json 反序列化出错 / 第三方改文件
      use_local_fonts: 'yes' as any,
      use_cozy_tokens: 1 as any
    }
    useSettingsStore.getState().hydrate(cfg)

    expect(useSettingsStore.getState().useLocalFonts).toBe(false)
    expect(useSettingsStore.getState().useCozyTokens).toBe(false)
    expect(document.documentElement.dataset.fontSource).toBe('remote')
    expect(document.documentElement.dataset.cozyTokens).toBe('off')
  })
})
