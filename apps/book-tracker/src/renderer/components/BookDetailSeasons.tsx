// BookDetail 「上一季 / 下一季」组合块
//
// 从 BookDetail.tsx 拆出(响应 DSH 插件 700 行/30KB 阈值)。
//
// 布局(v2.x 起,用户嫌中间细线多余):
// - 镜像布局:左半边整体靠左(label 在最左 = "上一季" 自身最左);
//   右半边镜像(整组靠右,label 在最右 = "下一季" 自身最右)——
//   用 flex-direction: row-reverse + justify-content: flex-end 实现
// - 极简交互:每侧只有 label + 内容 + 可选×;没有「改」按钮(要改先×再+)
//
// prev 三态:
//   1. prevSeasonId 未设 + prevSeasonExplicit=false → 「未设置」→ label + +设置按钮
//   2. prevSeasonId 已设 + prevSeasonExplicit=true(主动设)或 prevSeasonId 显式 Some
//      → 「已设 prev」→ label + content + ×
//   3. prevSeasonId = None + prevSeasonExplicit=true → 「明确没有上一季」
//      → label + 空 + ×(视觉上跟「未设置」区分:有×无+)
//   视觉上 (2) 和 (3) 都有 × 按钮,区别只在 content 有没有值
//
// next 简化:只有「未设」和「已设」两态(service 路径固定单向,不需要 explicit 标记)。

import type { Book } from '@shared/types'
import { NextSeasonPicker } from './NextSeasonPicker'

export interface BookDetailSeasonsProps {
  book: Book
  prevSeasonBook: Book | undefined
  nextSeasonBook: Book | undefined
  nextSeasonCandidates: Book[]
  seasonPickerMode: 'prev' | 'next' | null
  onSelectBook: (id: string) => void
  onSetSeasonPickerMode: (m: 'prev' | 'next' | null) => void
  onSetPrevSeason: (id: string) => Promise<void>
  onSetNextSeason: (id: string) => Promise<void>
  onClearPrevSeason: () => Promise<void>
  onClearNextSeason: () => Promise<void>
}

export function BookDetailSeasons(props: BookDetailSeasonsProps): JSX.Element {
  const {
    book, prevSeasonBook, nextSeasonBook, nextSeasonCandidates, seasonPickerMode,
    onSelectBook, onSetSeasonPickerMode, onSetPrevSeason, onSetNextSeason,
    onClearPrevSeason, onClearNextSeason
  } = props

  return (
    <section className="season-pair-block">
      <div className="season-pair">
        {/* 左侧:上一季 —— 整体靠左,label 在最左 */}
        <div className="prev-season">
          <span className="prev-season-label">上一季</span>
          {/* prev "已设"判断:prevSeasonExplicit=true(主动设了 None 或 Some)
              或 prevSeasonId 是 Some —— 任何"用户/数据明确指向某 prev"的状态 */}
          {book.prevSeasonExplicit === true ||
          (book.prevSeasonId !== undefined && book.prevSeasonId !== '') ? (
            // 已设(可能是某个 prev 或明确"没有")
            <>
              {prevSeasonBook ? (
                <span
                  className="prev-season-link"
                  onClick={() => onSelectBook(prevSeasonBook.id)}
                  title="点击跳到该作品"
                >
                  {prevSeasonBook.title}
                </span>
              ) : book.prevSeasonId ? (
                // prevSeasonId 有值但书被删了 —— 优雅降级
                <span className="prev-season-missing">
                  原作品已删除 (id: {book.prevSeasonId})
                </span>
              ) : null /* 明确「没有上一季」:content 区留空,只靠 × 按钮跟「未设置」区分 */}
              <button
                type="button"
                className="prev-season-remove"
                onClick={() => void onClearPrevSeason()}
                title="移除上一季关联(回到「未设置」状态)"
              >
                ×
              </button>
            </>
          ) : (
            // 未设置 —— label + +设置按钮
            <button
              type="button"
              className="prev-season-add"
              onClick={() => onSetSeasonPickerMode('prev')}
              title="主动设置上一季(粘性) / 标记「没有上一季」"
            >
              + 设置上一季
            </button>
          )}
        </div>

        {/* 右侧:下一季 —— 镜像布局(label 在最右,整组靠右) */}
        <div className="next-season">
          {book.nextSeasonId === undefined || book.nextSeasonId === '' ? (
            <>
              <button
                type="button"
                className="next-season-add"
                onClick={() => onSetSeasonPickerMode('next')}
              >
                + 设置下一季
              </button>
              <span className="next-season-label">下一季</span>
            </>
          ) : nextSeasonBook ? (
            <>
              <button
                type="button"
                className="next-season-remove"
                onClick={() => void onClearNextSeason()}
                title="移除下一季关联(回到「未设置」状态)"
              >
                ×
              </button>
              <span
                className="next-season-link"
                onClick={() => onSelectBook(nextSeasonBook.id)}
                title="点击跳到该作品"
              >
                {nextSeasonBook.title}
              </span>
              <span className="next-season-label">下一季</span>
            </>
          ) : (
            // 引用了已被删除的作品 —— 优雅降级
            <>
              <button
                type="button"
                className="next-season-remove"
                onClick={() => void onClearNextSeason()}
                title="清除失效的下一季引用"
              >
                ×
              </button>
              <span className="next-season-missing">
                原作品已删除 (id: {book.nextSeasonId})
              </span>
              <span className="next-season-label">下一季</span>
            </>
          )}
        </div>
      </div>
      <NextSeasonPicker
        open={seasonPickerMode !== null}
        onClose={() => onSetSeasonPickerMode(null)}
        candidates={nextSeasonCandidates}
        onPick={(id) => (seasonPickerMode === 'prev' ? void onSetPrevSeason(id) : void onSetNextSeason(id))}
        currentTitle={book.title}
        mode={seasonPickerMode ?? 'next'}
      />
    </section>
  )
}
