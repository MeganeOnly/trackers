// BookDetail 字段行渲染 —— 详情页内联可编辑表单
//
// 从 BookDetail.tsx 拆出(响应 DSH 插件 700 行/30KB 阈值,原文件 964 行)。
// 持有「作品字段 InlineField 行 + 笔记预览/编辑二态 + 侧栏收起 checkbox」,
// 父组件 BookDetail 仍然负责所有 state(为不引入 Context / reducer,
// 让「表单字段变化 → save」链路最短)。
//
// 字段行布局(v2.x 重排后,每行 2 列 grid,缺失位用 .field-row-placeholder 撑列):
//   row 1: 作品类型 | 年份
//   row 2: 原作/主创 | 译者(仅 book)/主演(影视)/编剧(影视)
//   row 2b: 编剧(仅 movie,独立行)
//   row 3: 原产国/地区 | 状态
//   row 4 (reading/watching): 第N次看 | 标签
//   row 4 (其他): 标签 | placeholder

import type { Book, BookStatus, WorkKind } from '@shared/types'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { MutableRefObject, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { InlineField } from './InlineField'
import { WikilinkText } from './WikilinkText'
import {
  STATUS_LABELS,
  authorLabelFor,
  countryLabelFor,
  screenwriterLabelFor,
  starringLabelFor,
  statusOptionsFor,
  translatorLabelFor,
  yearLabelFor
} from './BookDetail.labels'

export interface BookDetailFieldsProps {
  // 父组件透传的 state
  book: Book
  kind: WorkKind
  year: string
  author: string
  translator: string
  country: string
  status: BookStatus
  readCount: number
  starring: string
  screenwriter: string
  tagsText: string
  collapsed: boolean
  notes: string
  noteEditing: boolean
  editingField: string | null
  error: string | null
  allBooks: Book[]
  // 父组件透传的 setters
  setKind: (k: WorkKind) => void
  setYear: (y: string) => void
  setAuthor: (a: string) => void
  setTranslator: (t: string) => void
  setCountry: (c: string) => void
  setStatus: (s: BookStatus) => void
  setReadCount: (n: number) => void
  setStarring: (s: string) => void
  setScreenwriter: (s: string) => void
  setTagsText: (t: string) => void
  setCollapsed: (c: boolean) => void
  setNoteEditing: (b: boolean) => void
  setEditingField: (f: string | null) => void
  // 笔记 wikilink(用 hook 出的 ref / handler)
  notesTaRef: MutableRefObject<HTMLTextAreaElement | null>
  handleNotesChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  /** notes textarea 的 onKeyDown 处理器(Esc 切回预览);为减少父组件耦合,父组件拼好后传入 */
  onNotesKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void
}

export function BookDetailFields(props: BookDetailFieldsProps): JSX.Element {
  const {
    book, kind, year, author, translator, country, status, readCount, starring, screenwriter,
    tagsText, collapsed, notes, noteEditing, editingField, error, allBooks,
    setKind, setYear, setAuthor, setTranslator, setCountry, setStatus, setReadCount,
    setStarring, setScreenwriter, setTagsText, setCollapsed, setNoteEditing, setEditingField,
    notesTaRef, handleNotesChange, onNotesKeyDown
  } = props

  return (
    <div className="detail-form">
      <div className="field-row">
        <InlineField
          fieldId="kind"
          label="作品类型"
          display={WORK_KIND_LABELS[kind]}
          value={kind}
          onChange={(v) => setKind(v as WorkKind)}
          kind="select"
          options={WORK_KIND_ORDER.map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))}
          editing={editingField === 'kind'}
          onActivate={() => setEditingField('kind')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder=""
        />
        <InlineField
          fieldId="year"
          label={yearLabelFor(kind)}
          display={year}
          value={year}
          onChange={setYear}
          kind="number"
          editing={editingField === 'year'}
          onActivate={() => setEditingField('year')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder="未设置"
          min={0}
          max={9999}
        />
      </div>
      <div className="field-row">
        <InlineField
          fieldId="author"
          label={authorLabelFor(kind)}
          display={author}
          value={author}
          onChange={setAuthor}
          kind="text"
          editing={editingField === 'author'}
          onActivate={() => setEditingField('author')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder="未设置"
        />
        {translatorLabelFor(kind) ? (
          <InlineField
            fieldId="translator"
            label={translatorLabelFor(kind)!}
            display={translator}
            value={translator}
            onChange={setTranslator}
            kind="text"
            editing={editingField === 'translator'}
            onActivate={() => setEditingField('translator')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
        ) : starringLabelFor(kind) ? (
          <InlineField
            fieldId="starring"
            label={starringLabelFor(kind)!}
            display={starring}
            value={starring}
            onChange={setStarring}
            kind="text"
            editing={editingField === 'starring'}
            onActivate={() => setEditingField('starring')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
        ) : (
          <span aria-hidden="true" className="field-row-placeholder" />
        )}
      </div>
      {/* movie 类型专属 row 2b —— 编剧独立一行,跟主演区分 */}
      {kind === 'movie' && screenwriterLabelFor(kind) && (
        <div className="field-row">
          <InlineField
            fieldId="screenwriter"
            label={screenwriterLabelFor(kind)!}
            display={screenwriter}
            value={screenwriter}
            onChange={setScreenwriter}
            kind="text"
            editing={editingField === 'screenwriter'}
            onActivate={() => setEditingField('screenwriter')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
          <span aria-hidden="true" className="field-row-placeholder" />
        </div>
      )}
      <div className="field-row">
        <InlineField
          fieldId="country"
          label={countryLabelFor(kind)}
          display={country}
          value={country}
          onChange={setCountry}
          kind="text"
          editing={editingField === 'country'}
          onActivate={() => setEditingField('country')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder="未设置"
        />
        <InlineField
          fieldId="status"
          label="状态"
          display={STATUS_LABELS[status]}
          value={status}
          onChange={(v) => setStatus(v as BookStatus)}
          kind="select"
          options={statusOptionsFor(kind).map((o) => ({ value: o.value, label: o.label }))}
          editing={editingField === 'status'}
          onActivate={() => setEditingField('status')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder=""
        />
      </div>
      {(status === 'reading' || status === 'watching') ? (
        <div className="field-row">
          <InlineField
            fieldId="readCount"
            label="第 N 次看"
            display={String(readCount)}
            value={String(readCount)}
            onChange={(v) => setReadCount(Math.max(1, Number(v) || 1))}
            // 输入时同步归一化,避免中间态(v='')导致 readCount=1 然后用户松开手再敲变成 0
            normalize={(v) => String(Math.max(1, Number(v) || 1))}
            kind="number"
            editing={editingField === 'readCount'}
            onActivate={() => setEditingField('readCount')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder=""
            min={1}
          />
          <InlineField
            fieldId="tags"
            label="标签"
            display={tagsText}
            value={tagsText}
            onChange={setTagsText}
            kind="text"
            editing={editingField === 'tags'}
            onActivate={() => setEditingField('tags')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
        </div>
      ) : (
        <div className="field-row">
          <InlineField
            fieldId="tags"
            label="标签"
            display={tagsText}
            value={tagsText}
            onChange={setTagsText}
            kind="text"
            editing={editingField === 'tags'}
            onActivate={() => setEditingField('tags')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
          <span aria-hidden="true" className="field-row-placeholder" />
        </div>
      )}
      <label className="form-checkline">
        <input
          type="checkbox"
          checked={collapsed}
          onChange={(e) => setCollapsed(e.target.checked)}
        />
        <span title="移到 EditMode 侧栏底部『已收起』分组（所有 status 都允许，纯展示，不影响 status 与解锁）">侧栏收起</span>
      </label>
      {/* 笔记 —— 默认预览(WikilinkText),点「笔记」标题切到 textarea 编辑 */}
      <div className="field note-field">
        <span
          className={`note-field-toggle${noteEditing ? ' is-editing' : ''}`}
          role="button"
          tabIndex={0}
          title={noteEditing ? '编辑中 —— 点外部或失焦返回预览' : '点击进入编辑'}
          onClick={() => setNoteEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setNoteEditing(true)
            }
          }}
        >
          笔记{!noteEditing && <span className="note-field-edit-hint">点击编辑</span>}
        </span>
        {noteEditing ? (
          <textarea
            ref={notesTaRef}
            value={notes}
            onChange={handleNotesChange}
            onBlur={() => setNoteEditing(false)}
            onKeyDown={onNotesKeyDown}
            rows={6}
            autoFocus
            placeholder="自由写 —— 心得 / 摘录 / 备忘(输入 [[ 触发角色选择)"
          />
        ) : (
          <WikilinkText
            text={notes}
            currentBook={book}
            allBooks={allBooks}
            className="wikilink-preview-block"
          />
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
