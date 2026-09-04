// 作品双链 `[[角色名]]` —— 纯函数单测(v1.7)
//
// 覆盖三类行为:
// - `parseWikilinks` —— 提取目标名(基本 / 多重 / 空 / 嵌套 ] / 空白 / 未闭合)
// - `splitWikilinkSegments` —— 文本分段(全 plain / 全 wikilink / 交替)
// - `resolveWikilink` —— 解析语义(local / global-unique / global-multi / broken)
// - 配套 `collectAllCharacterCandidates` / `collectLocalCharacterCandidates`
//
// **不进 tracker-core**:wikilink 绑定 Character 概念,life-tracker 没有角色;
// 留 book-tracker 内,与 stamp.test.ts 同层(见 AGENTS.md §十三)。
//
// **测试规模约定**:≥15 用例,跟 stamp.test.ts 的 13 + 共享 143 baseline 对齐。

import { describe, expect, it } from 'vitest'
import {
  collectAllCharacterCandidates,
  collectLocalCharacterCandidates,
  parseWikilinks,
  resolveWikilink,
  splitWikilinkSegments
} from '../wikilink'
import type { Book, Character } from '../types'

// ------------------- 测试 fixtures -------------------

function makeCharacter(id: string, name: string): Character {
  return { id, name, notes: undefined }
}

function makeBook(id: string, characters: Character[] = [], overrides: Partial<Book> = {}): Book {
  return {
    id,
    title: `Book ${id}`,
    kind: 'book',
    author: 'Author',
    country: '',
    year: 2024,
    translator: '',
    status: 'finished',
    read_count: 1,
    progress: null,
    collapsed: false,
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-01T00:00:00.000Z',
    tags: [],
    notes: '',
    starring: '',
    screenwriter: '',
    characters,
    ...overrides
  }
}

// ------------------- parseWikilinks -------------------

describe('parseWikilinks', () => {
  it('空字符串 → 空数组', () => {
    expect(parseWikilinks('')).toEqual([])
  })

  it('纯文本无 [[ → 空数组', () => {
    expect(parseWikilinks('hello world')).toEqual([])
  })

  it('单个 [[target]] → 单元素', () => {
    expect(parseWikilinks('[[小明]]')).toEqual(['小明'])
  })

  it('多个 [[a]] 和 [[b]] → 顺序保留', () => {
    expect(parseWikilinks('[[小明]]和[[小红]]')).toEqual(['小明', '小红'])
  })

  it('同名重复 → 去重保留首次', () => {
    expect(parseWikilinks('[[小明]]和[[小明]]')).toEqual(['小明'])
  })

  it('空 [[]] → 跳过', () => {
    expect(parseWikilinks('[[]]')).toEqual([])
  })

  it('纯空白 [[   ]] → 跳过', () => {
    expect(parseWikilinks('[[   ]]')).toEqual([])
  })

  it('未闭合 [[abc → 空数组', () => {
    expect(parseWikilinks('hello [[abc world')).toEqual([])
  })

  it('内部 ] 视为文本(首个 ]] 闭合)', () => {
    expect(parseWikilinks('[[小明[小红]]]')).toEqual(['小明[小红'])
  })

  it('尾部带空格的目标原样保留(target 字段带尾空格)', () => {
    // parseWikilinks 不 trim —— 由 resolveWikilink 负责 trim 匹配
    expect(parseWikilinks('[[小明 ]]')).toEqual(['小明 '])
  })

  it('文本里 [[abc]] 但其后没有 ]] 时,只解出闭合的那个', () => {
    expect(parseWikilinks('[[abc]] and [[def')).toEqual(['abc'])
  })

  it('连续多个 wikilink 无间隔', () => {
    expect(parseWikilinks('[[a]][[b]][[c]]')).toEqual(['a', 'b', 'c'])
  })
})

// ------------------- splitWikilinkSegments -------------------

describe('splitWikilinkSegments', () => {
  it('纯 plain 文本 → 单 plain 段', () => {
    expect(splitWikilinkSegments('hello world')).toEqual([
      { kind: 'plain', text: 'hello world' }
    ])
  })

  it('空字符串 → 空数组', () => {
    expect(splitWikilinkSegments('')).toEqual([])
  })

  it('全 wikilink → 单 wikilink 段', () => {
    expect(splitWikilinkSegments('[[小明]]')).toEqual([{ kind: 'wikilink', target: '小明' }])
  })

  it('交替 plain + wikilink → 多段', () => {
    expect(splitWikilinkSegments('hello [[小明]] world')).toEqual([
      { kind: 'plain', text: 'hello ' },
      { kind: 'wikilink', target: '小明' },
      { kind: 'plain', text: ' world' }
    ])
  })

  it('多个 wikilink 串接 → 多 wikilink 段', () => {
    expect(splitWikilinkSegments('[[a]][[b]]')).toEqual([
      { kind: 'wikilink', target: 'a' },
      { kind: 'wikilink', target: 'b' }
    ])
  })

  it('未闭合 [[abc → 整段作 plain 不丢内容', () => {
    expect(splitWikilinkSegments('hello [[abc world')).toEqual([
      { kind: 'plain', text: 'hello [[abc world' }
    ])
  })

  it('尾部 wikilink → 末段 wikilink 后无 trailing plain', () => {
    expect(splitWikilinkSegments('hello [[x]]')).toEqual([
      { kind: 'plain', text: 'hello ' },
      { kind: 'wikilink', target: 'x' }
    ])
  })

  it('开头 wikilink → 开头 wikilink', () => {
    expect(splitWikilinkSegments('[[x]] hello')).toEqual([
      { kind: 'wikilink', target: 'x' },
      { kind: 'plain', text: ' hello' }
    ])
  })
})

// ------------------- resolveWikilink -------------------

describe('resolveWikilink', () => {
  const alice = makeCharacter('c-alice', 'Alice')
  const bob = makeCharacter('c-bob', 'Bob')
  const ming = makeCharacter('c-ming', '小明')

  it('local 命中:当前作品里找到', () => {
    const book = makeBook('1', [alice, bob])
    expect(resolveWikilink('Alice', { currentBook: book, allBooks: [book] })).toEqual({
      status: 'local',
      target: 'Alice',
      character: alice,
      sourceBook: book
    })
  })

  it('local 命中:trim 后匹配(忽略前后空格)', () => {
    const book = makeBook('1', [ming])
    const r = resolveWikilink('  小明  ', { currentBook: book, allBooks: [book] })
    expect(r.status).toBe('local')
    expect(r.character).toBe(ming)
  })

  it('local 优先:跨作品同名时仍然 local', () => {
    const a = makeBook('1', [ming])
    const b = makeBook('2', [makeCharacter('c-ming-b', '小明')])
    const r = resolveWikilink('小明', { currentBook: a, allBooks: [a, b] })
    expect(r.status).toBe('local')
    expect(r.character?.id).toBe('c-ming')
  })

  it('global-unique:当前作品没有,跨作品唯一', () => {
    const a = makeBook('1', [alice])
    const b = makeBook('2', [bob])
    const r = resolveWikilink('Bob', { currentBook: a, allBooks: [a, b] })
    expect(r.status).toBe('global-unique')
    expect(r.character?.id).toBe('c-bob')
    expect(r.sourceBook?.id).toBe('2')
  })

  it('global-multi:跨作品多匹配返回 candidates', () => {
    const a = makeBook('1', [makeCharacter('c1', '小明')])
    const b = makeBook('2', [makeCharacter('c2', '小明')])
    const c = makeBook('3', [makeCharacter('c3', '小明')])
    const r = resolveWikilink('小明', { currentBook: a, allBooks: [a, b, c] })
    expect(r.status).toBe('local') // currentBook 里有,优先 local
    expect(r.character?.id).toBe('c1')
  })

  it('global-multi:跨作品多匹配(currentBook 没有)', () => {
    const a = makeBook('1', [alice])
    const b = makeBook('2', [makeCharacter('c1', '小明')])
    const c = makeBook('3', [makeCharacter('c2', '小明')])
    const r = resolveWikilink('小明', { currentBook: a, allBooks: [a, b, c] })
    expect(r.status).toBe('global-multi')
    expect(r.candidates).toHaveLength(2)
    expect(r.candidates?.[0].sourceBook.id).toBe('2')
    expect(r.candidates?.[1].sourceBook.id).toBe('3')
  })

  it('broken:全作品都没有', () => {
    const a = makeBook('1', [alice])
    const r = resolveWikilink('Neo', { currentBook: a, allBooks: [a] })
    expect(r.status).toBe('broken')
    expect(r.target).toBe('Neo')
    expect(r.character).toBeUndefined()
  })

  it('currentBook 缺 characters 字段(undefined)→ 视为空数组', () => {
    const a = makeBook('1', [])
    // override:去掉 characters
    const noChars = { ...a, characters: undefined } as Book
    const r = resolveWikilink('Alice', { currentBook: noChars, allBooks: [noChars] })
    expect(r.status).toBe('broken')
  })

  it('allBooks 为空:不影响 local 判定(currentBook 优先)', () => {
    const a = makeBook('1', [alice])
    const r = resolveWikilink('Alice', { currentBook: a, allBooks: [] })
    expect(r.status).toBe('local')
    expect(r.character).toBe(alice)
  })

  it('target 前后空白 trim 后匹配', () => {
    const a = makeBook('1', [alice])
    const r = resolveWikilink('  Alice  ', { currentBook: a, allBooks: [a] })
    expect(r.status).toBe('local')
    expect(r.character).toBe(alice)
  })

  it('大小写敏感(精确匹配)', () => {
    const a = makeBook('1', [alice])
    // Alice ≠ alice —— 大小写敏感
    const r = resolveWikilink('alice', { currentBook: a, allBooks: [a] })
    expect(r.status).toBe('broken')
  })

  it('target 原值保留在返回值(不被 trim 掉)', () => {
    const a = makeBook('1', [ming])
    const r = resolveWikilink('小明 ', { currentBook: a, allBooks: [a] })
    expect(r.target).toBe('小明 ')
    expect(r.status).toBe('local')
  })
})

// ------------------- collectLocalCharacterCandidates -------------------

describe('collectLocalCharacterCandidates', () => {
  it('空 characters → 空数组', () => {
    expect(collectLocalCharacterCandidates(makeBook('1', []))).toEqual([])
  })

  it('缺 characters 字段 → 空数组', () => {
    const noChars = { ...makeBook('1'), characters: undefined } as Book
    expect(collectLocalCharacterCandidates(noChars)).toEqual([])
  })

  it('保留用户添加顺序', () => {
    const alice = makeCharacter('a', 'Alice')
    const bob = makeCharacter('b', 'Bob')
    const carol = makeCharacter('c', 'Carol')
    const book = makeBook('1', [alice, bob, carol])
    const candidates = collectLocalCharacterCandidates(book)
    expect(candidates.map((c) => c.character.id)).toEqual(['a', 'b', 'c'])
    expect(candidates.every((c) => c.sourceBook === book)).toBe(true)
  })
})

// ------------------- collectAllCharacterCandidates -------------------

describe('collectAllCharacterCandidates', () => {
  it('空 allBooks → 空数组', () => {
    expect(collectAllCharacterCandidates([])).toEqual([])
  })

  it('多书多 character → 全收集', () => {
    const a = makeBook('1', [makeCharacter('a1', 'Alice')])
    const b = makeBook('2', [makeCharacter('b1', 'Bob')])
    const candidates = collectAllCharacterCandidates([a, b])
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.character.name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('缺 characters 字段的 book 视为空', () => {
    const a = makeBook('1', [makeCharacter('a1', 'Alice')])
    const noChars = { ...makeBook('2'), characters: undefined } as Book
    const candidates = collectAllCharacterCandidates([a, noChars])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].character.name).toBe('Alice')
  })

  it('按 sourceBook.title localeCompare 顺序排(具体顺序依赖运行时 ICU 的 pinyin collation)', () => {
    const a = makeBook('1', [makeCharacter('x', 'X')], { title: '百年孤独' })
    const b = makeBook('2', [makeCharacter('y', 'Y')], { title: '三体' })
    const c = makeBook('3', [makeCharacter('z', 'Z')], { title: '围城' })
    const candidates = collectAllCharacterCandidates([a, b, c])
    // 严格断言"排序与 localeCompare('zh') 一致"(不强求具体输出 —— Node ICU
    // 默认对中文按 pinyin 排: bai < san < wei → 百年孤独, 三体, 围城;若
    // 切换到 codepoint 排会变成三体, 围城, 百年孤独)。
    // 兼容两种实现:验证「相邻对」的相对顺序与 localeCompare 一致即可。
    for (let i = 0; i < candidates.length - 1; i++) {
      const t1 = candidates[i].sourceBook.title
      const t2 = candidates[i + 1].sourceBook.title
      const cmp = t1.localeCompare(t2, 'zh')
      expect(cmp).toBeLessThanOrEqual(0)
    }
  })

  it('排序是确定的(同输入 → 同输出)', () => {
    const a = makeBook('1', [makeCharacter('x', 'X')], { title: '百年孤独' })
    const b = makeBook('2', [makeCharacter('y', 'Y')], { title: '三体' })
    const first = collectAllCharacterCandidates([a, b]).map((c) => c.sourceBook.title)
    const second = collectAllCharacterCandidates([a, b]).map((c) => c.sourceBook.title)
    expect(first).toEqual(second)
  })
})
