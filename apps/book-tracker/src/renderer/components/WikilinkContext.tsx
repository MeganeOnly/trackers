// 作品双链 `[[角色名]]` —— 全局协调层
//
// 职责:把 wikilink 的 4 类交互(本地跳转 / 跨作品跳转 / 跨作品 picker / 断链创建)
// 统一到一个 React Context,避免在 BookDetail / CharactersPanel / EpisodesPanel
// 各组件里散落实现。
//
// 设计原则:
// - **不持久化任何 wikilink 状态到 store**:纯 UI 协调层,关掉 app 就清空
// - **picker 模态全局唯一**:同时只能开一个(避免多 textarea 同时触发打架)
// - **create-character 模态全局唯一**:同上
// - **跨作品跳转走 store.navigateToCharacter**:CharactersPanel 监听后自动展开;
//   当前作品跳转直接调 select() 切 book 即可。
//
// 跟 store 的关系:
// - navigateLocal → 不切 book(只滚 + 展开) → store.navigateToCharacter
// - navigateGlobal → 切 book + 滚 + 展开 → store.select() + store.navigateToCharacter

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { Book } from '@shared/types'
import type { WikilinkCandidate } from '@shared/wikilink'
import { useBooksStore } from '../store/books'
import { WikilinkPickerModal } from './WikilinkPickerModal'
import { WikilinkCreateCharacterModal } from './WikilinkCreateCharacterModal'

// ------------------- Context 接口 -------------------

interface PickerRequest {
  /** 当前作品 id(用于"create new character"时知道加到哪本书) */
  bookId: string
  /** 候选(已有 character),通常是当前作品的 character 列表 */
  candidates: WikilinkCandidate[]
  /** 触发 picker 时已经输入的初始搜索词(用户在 textarea 已经敲了"小"等) */
  initialName: string
  /** picker 关闭时回调(用户选了已有角色 → name 是该 character.name;
   *  用户创建新角色 → name 是新角色的 name)。parent 据此插入 `[[name]]` 到 textarea。 */
  onResolve: (name: string) => void
}

interface CreateRequest {
  /** 把新角色加到哪本书 */
  bookId: string
  /** 新角色名(target) */
  target: string
  /** 创建完成时回调(返回新 character 的 id) */
  onCreated: (characterId: string) => void
}

export interface WikilinkContextValue {
  /** 当前 textarea 触发 `[[` 时调用 —— 打开全局 picker */
  openPicker: (req: PickerRequest) => void
  /** 用户点击断链 [[xxx]] 时调用 —— 打开全局 create modal */
  openCreate: (req: CreateRequest) => void
  /** 点击 resolved local wikilink 时调用 —— 滚到角色 + 展开 */
  navigateLocal: (bookId: string, characterId: string) => void
  /** 点击 resolved global-unique wikilink 时调用 —— 切到目标 book + 展开 */
  navigateGlobal: (targetBookId: string, characterId: string) => void
  /** 点击 resolved global-multi wikilink 时调用 —— 打开跨作品 picker */
  openGlobalPicker: (target: string, candidates: WikilinkCandidate[]) => void
}

const WikilinkContext = createContext<WikilinkContextValue | null>(null)

/** 在子组件里取 wikilink handlers;Provider 没包时返回兜底 no-op(让单测能裸渲染)。 */
export function useWikilink(): WikilinkContextValue {
  const ctx = useContext(WikilinkContext)
  if (ctx) return ctx
  // 兜底:Provider 没包时仍允许组件渲染,所有跳转都是 no-op
  return {
    openPicker: () => {},
    openCreate: () => {},
    navigateLocal: () => {},
    navigateGlobal: () => {},
    openGlobalPicker: () => {}
  }
}

// ------------------- Provider -------------------

interface WikilinkProviderProps {
  children: React.ReactNode
}

/**
 * 把全局 picker / create modal 挂在 children 之上。
 *
 * 状态:
 * - `pickerRequest`:当前活跃的 picker(单个 textarea 触发后置入,close 后清空)
 * - `createRequest`:当前活跃的 create 模态(点击断链触发后置入)
 * - `globalPickerRequest`:点击 multi wikilink 时打开的跨作品 picker
 *
 * 两个 picker 同时只能存在一个(create 可与 picker 共存,但 v1.7 不暴露该场景)。
 */
export function WikilinkProvider({ children }: WikilinkProviderProps): JSX.Element {
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null)
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [globalPickerRequest, setGlobalPickerRequest] = useState<{
    target: string
    candidates: WikilinkCandidate[]
    onResolve: (bookId: string, characterId: string) => void
  } | null>(null)

  const setNavigateToCharacter = useBooksStore((s) => s.setNavigateToCharacter)
  const select = useBooksStore((s) => s.select)
  const books = useBooksStore((s) => s.books)
  const allBooks: Book[] = books

  const openPicker = useCallback((req: PickerRequest): void => {
    setPickerRequest(req)
    setGlobalPickerRequest(null)
  }, [])

  const openCreate = useCallback((req: CreateRequest): void => {
    setCreateRequest(req)
  }, [])

  const navigateLocal = useCallback(
    (bookId: string, characterId: string): void => {
      setNavigateToCharacter({ bookId, characterId })
    },
    [setNavigateToCharacter]
  )

  const navigateGlobal = useCallback(
    (targetBookId: string, characterId: string): void => {
      // 1) 切到目标作品
      select(targetBookId)
      // 2) 让 CharactersPanel 展开对应 character
      setNavigateToCharacter({ bookId: targetBookId, characterId })
    },
    [select, setNavigateToCharacter]
  )

  const openGlobalPicker = useCallback(
    (target: string, candidates: WikilinkCandidate[]): void => {
      setGlobalPickerRequest({
        target,
        candidates,
        onResolve: (bookId, characterId) => {
          navigateGlobal(bookId, characterId)
        }
      })
      setPickerRequest(null)
    },
    [navigateGlobal]
  )

  const value = useMemo<WikilinkContextValue>(
    () => ({
      openPicker,
      openCreate,
      navigateLocal,
      navigateGlobal,
      openGlobalPicker
    }),
    [openPicker, openCreate, navigateLocal, navigateGlobal, openGlobalPicker]
  )

  return (
    <WikilinkContext.Provider value={value}>
      {children}
      {/* 普通 picker —— `[[` 触发,候选 = 当前作品 characters */}
      {pickerRequest && (
        <WikilinkPickerModal
          candidates={pickerRequest.candidates}
          initialName={pickerRequest.initialName}
          showCreate
          onPick={(candidate) => {
            pickerRequest.onResolve(candidate.character.name)
            setPickerRequest(null)
          }}
          onCreate={(name) => {
            const cb = pickerRequest.onResolve
            setPickerRequest(null)
            // 关闭 picker,打开 create modal —— 创建完成后回调 onResolve
            setCreateRequest({
              bookId: pickerRequest.bookId,
              target: name,
              onCreated: () => cb(name)
            })
          }}
          onClose={() => setPickerRequest(null)}
        />
      )}
      {/* 跨作品 picker —— 点击 multi wikilink 触发,候选 = 全部作品同名 */}
      {globalPickerRequest && (
        <WikilinkPickerModal
          candidates={globalPickerRequest.candidates}
          initialName=""
          showCreate={false}
          onPick={(candidate) => {
            globalPickerRequest.onResolve(candidate.sourceBook.id, candidate.character.id)
            setGlobalPickerRequest(null)
          }}
          onCreate={() => {
            // global picker 不允许创建(v1.7);noop
          }}
          onClose={() => setGlobalPickerRequest(null)}
        />
      )}
      {/* 创建模态 —— 断链触发;内部完成 setCharacters 后回调 onCreated */}
      {createRequest && (
        <WikilinkCreateCharacterModal
          target={createRequest.target}
          bookId={createRequest.bookId}
          allBooks={allBooks}
          onCreated={(characterId) => {
            createRequest.onCreated(characterId)
            setCreateRequest(null)
          }}
          onCancel={() => setCreateRequest(null)}
        />
      )}
    </WikilinkContext.Provider>
  )
}
