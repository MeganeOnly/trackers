// 作品双链 `[[角色名]]` —— 纯函数解析与解析
//
// 职责:
// - `parseWikilinks(text)`:从一段文本里提取所有 `[[...]]` 的目标名(去重保留顺序)
// - `splitWikilinkSegments(text)`:把文本切成 plain / wikilink 段,供渲染层遍历
// - `resolveWikilink(target, ctx)`:在「当前作品 + 全作品」上下文中
//   解析一个目标名 → 本地命中 / 全局唯一 / 全局多匹配 / 断链
//
// **不进 tracker-core 的理由**:`Character` 是 book-tracker 领域专属(v1.5),
// life-tracker 没有角色概念。本文件留 book-tracker 内,跟 stamp.test.ts 同层。
//
// **数据格式约定**:`[[...]]` 原样存进 .md frontmatter 字符串,本模块只负责
// 解析层;写入 / 存储层不动。这是 v1.7 wikilink 的核心设计 —— 后端零改动。

import type { Book, Character } from './types'

/** 一段被切出来的文本。kind 决定渲染策略。 */
export type WikilinkSegment =
  | { kind: 'plain'; text: string }
  | { kind: 'wikilink'; target: string }

/** 解析状态(对一个 `[[target]]` 的解析结果) */
export type WikilinkResolveStatus =
  | 'local' // 当前作品里找到了该 character
  | 'global-unique' // 当前作品没有,但跨作品唯一命中
  | 'global-multi' // 跨作品有多条同名 character
  | 'broken' // 哪里都没找到

/** `resolveWikilink` 的解析上下文 */
export interface ResolveContext {
  /** 当前笔记所属的作品(用于「本地命中」判定) */
  currentBook: Book
  /** 全作品列表(用于「跨作品兜底」) */
  allBooks: Book[]
}

/** 一个候选(全局 picker 用) */
export interface WikilinkCandidate {
  character: Character
  sourceBook: Book
}

/** `resolveWikilink` 的返回值 */
export interface WikilinkResolve {
  status: WikilinkResolveStatus
  /** 原目标名(原样保留,不改大小写) */
  target: string
  /** status === 'local' 时 = 当前作品里的 character */
  character?: Character
  /** status === 'local' / 'global-unique' 时 = 角色所在作品
   *  (local 时就是 currentBook 本身,但仍附上方便调用方不用再 find) */
  sourceBook?: Book
  /** status === 'global-multi' 时 = 全部候选 */
  candidates?: WikilinkCandidate[]
}

/**
 * 从文本里提取所有 `[[...]]` 内的目标名。
 *
 * 规则:
 * - 去重保留首次出现顺序
 * - 跳过空 / 纯空白 / 缺右 `]]` 的未闭合片段
 * - 内部 `]` 视为文本一部分(用首个 `]]` 闭合)
 * - 不做 trim —— 原样保留 `[[小明 ]]` 的尾部空格;上层 `resolveWikilink`
 *   对结果做 trim 后匹配
 *
 * 例:
 * - `parseWikilinks("")` → `[]`
 * - `parseWikilinks("hello")` → `[]`
 * - `parseWikilinks("[[小明]]")` → `["小明"]`
 * - `parseWikilinks("[[小明]]和[[小红]]")` → `["小明", "小红"]`
 * - `parseWikilinks("[[小明]]和[[小明]]")` → `["小明"]`(去重)
 * - `parseWikilinks("[[]]")` → `[]`(空)
 * - `parseWikilinks("[[小明")` → `[]`(未闭合)
 * - `parseWikilinks("[[小明[小红]]]")` → `["小明[小红"]`(首个 `]]` 闭合)
 */
export function parseWikilinks(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('[[', i)
    if (open === -1) break
    // 跳过前导空 `[[`
    const close = text.indexOf(']]', open + 2)
    if (close === -1) break // 后续都没闭合 → 结束
    const target = text.slice(open + 2, close)
    // 跳过空 / 纯空白
    if (target.trim() !== '' && !seen.has(target)) {
      seen.add(target)
      out.push(target)
    }
    i = close + 2
  }
  return out
}

/**
 * 把文本切成 plain / wikilink 段。
 *
 * 渲染层用:遍历结果,wilink 段渲染成可点击 span / button,
 * plain 段原样输出。
 *
 * 规则同 `parseWikilinks` —— 内部 `]` 视为文本,未闭合的 `[[`
 * 视为 plain(不丢内容):遇到未闭合 `[[` 时,buf 不 flush,直接把
 * `[[` 和后续字符继续追加进 buf,让整段(包括未闭合 `[[`)
 * 落在一个 plain 段里。
 */
export function splitWikilinkSegments(text: string): WikilinkSegment[] {
  const segments: WikilinkSegment[] = []
  let buf = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('[[', i)
    if (open === -1) {
      buf += text.slice(i)
      break
    }
    // [[ 之前的 plain 字符
    buf += text.slice(i, open)
    const close = text.indexOf(']]', open + 2)
    if (close === -1) {
      // 未闭合 → buf 继续累积 `[[` 和后续所有内容,整段作 plain
      buf += text.slice(open)
      break
    }
    // 闭合 → 先把前面的 buf 作为 plain 段 flush,再 push wikilink 段
    if (buf.length > 0) {
      segments.push({ kind: 'plain', text: buf })
      buf = ''
    }
    segments.push({ kind: 'wikilink', target: text.slice(open + 2, close) })
    i = close + 2
  }
  if (buf.length > 0) {
    segments.push({ kind: 'plain', text: buf })
  }
  return segments
}

/**
 * 在上下文里解析一个目标名 → 命中位置 / 候选 / 断链。
 *
 * 匹配规则(精确匹配,大小写敏感):
 * 1. local:在 `currentBook.characters` 里 `name === target`(trim 后比对)
 * 2. global-unique:跨作品扫,只有 1 条命中
 * 3. global-multi:跨作品有多条命中
 * 4. broken:都没命中
 *
 * target 的前后空白会被 trim 后用于匹配;返回值里 `target` 字段保留
 * 原值(让 UI 能显示用户原本写的"[[小明 ]]"尾巴空格)。
 *
 * currentBook.characters 缺字段(undefined)等同于空数组;
 * allBooks 为空 / 缺 characters 字段的 book 视为空字符集。
 */
export function resolveWikilink(target: string, ctx: ResolveContext): WikilinkResolve {
  const trimmedTarget = target.trim()
  const localChars = ctx.currentBook.characters ?? []

  // 1. local
  const local = localChars.find((c) => c.name.trim() === trimmedTarget)
  if (local) {
    return { status: 'local', target, character: local, sourceBook: ctx.currentBook }
  }

  // 2. global 兜底
  const candidates: WikilinkCandidate[] = []
  for (const book of ctx.allBooks) {
    const chars = book.characters ?? []
    for (const c of chars) {
      if (c.name.trim() === trimmedTarget) {
        candidates.push({ character: c, sourceBook: book })
      }
    }
  }
  if (candidates.length === 1) {
    const only = candidates[0]
    return {
      status: 'global-unique',
      target,
      character: only.character,
      sourceBook: only.sourceBook
    }
  }
  if (candidates.length > 1) {
    return { status: 'global-multi', target, candidates }
  }

  // 3. broken
  return { status: 'broken', target }
}

/**
 * 把全作品的 character 全打成候选(给跨作品 picker 用,不考虑「当前作品」优先)。
 *
 * 排序规则:同名 character 按 sourceBook.title 升序(中文 localeCompare);
 * 同一 sourceBook 内的 character 按添加顺序(`Character[]` 保留用户 add 顺序)。
 */
export function collectAllCharacterCandidates(allBooks: Book[]): WikilinkCandidate[] {
  const out: WikilinkCandidate[] = []
  for (const book of allBooks) {
    const chars = book.characters ?? []
    for (const c of chars) {
      out.push({ character: c, sourceBook: book })
    }
  }
  out.sort((a, b) => {
    const titleCmp = a.sourceBook.title.localeCompare(b.sourceBook.title, 'zh')
    if (titleCmp !== 0) return titleCmp
    return 0
  })
  return out
}

/**
 * 把当前作品的 character 全打成候选(给 `[[` 输入触发的 picker 用)。
 *
 * 排序规则:用户添加顺序(Character[] 已保留 add 顺序,直接遍历即可);
 * 不做额外排序,保持 UI 与 CharactersPanel 列表顺序一致。
 */
export function collectLocalCharacterCandidates(book: Book): WikilinkCandidate[] {
  const chars = book.characters ?? []
  return chars.map((c) => ({ character: c, sourceBook: book }))
}
