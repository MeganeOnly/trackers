// 统一「添加」modal(v1.8 新增)—— 整合加作品 / 加系列 / 管理系列到单一入口。
//
// **为什么不再有 TopBar「系」按钮**:v1.7 在 TopBar 加「系」按钮(SeriesModal),
// 跟「+ 加作品」按钮并列,导致 UI 上多了第二个「添加」入口,语义割裂。
// 用户核心诉求是「添加系列」也应该在「+」按钮里 —— 但加系列需要的表单字段
// (name + notes) 跟加作品(name + author + kind + ...)完全不一样,所以需要 tab
// 切换 + 内容切换。
//
// **tab 设计**:
// - 「+ 作品」: 复用 BookFormFields —— 完整作品表单(原 BookForm 抽出)
// - 「+ 系列」: SeriesView —— 顶部 inline 新建 + 列表管理(原 SeriesModal 抽出)
//
// **默认 tab**:「+ 作品」—— 加作品是主要场景(加系列从主入口也能一行表单搞定)。
//
// **modal 内嵌 modal**:两个 tab 内容均不含 Modal 包装(从原 BookForm / SeriesModal
// 抽出时已剥离),AddModal 是唯一 Modal,避免嵌套。
//
// **footer 策略**:
// - 「作品」tab: 「取消」+「保存」 —— 由 BookFormFields 内部 form id="book-form"
//   触发提交(同原 BookForm)
// - 「系列」tab: 无 footer —— SeriesView 自身有 CRUD 按钮;关闭走右上 × 或 Esc
//
// **键盘 / 焦点**(与 v1.7 一致):Modal 包装层处理 Esc + 点 backdrop 关闭;
// 「系列」tab 内 inline input 回车 = 新建(SeriesView 自带)。

import { useState } from 'react'
import { Modal } from './Modal'
import { BookFormFields } from './BookFormFields'
import { SeriesView } from './SeriesView'

interface AddModalProps {
  onClose: () => void
  /** 默认打开的 tab(v1.8 起:目前都默认 'book',留 prop 给后续调用方选择) */
  initialTab?: AddTab
}

type AddTab = 'book' | 'series'

const TAB_LABELS: Record<AddTab, string> = {
  book: '+ 作品',
  series: '+ 系列'
}

export function AddModal({ onClose, initialTab = 'book' }: AddModalProps): JSX.Element {
  const [tab, setTab] = useState<AddTab>(initialTab)

  return (
    <Modal
      title="添加"
      onClose={onClose}
      width={tab === 'book' ? 600 : 560}
      backdropClassName="modal-backdrop--top"
      footer={
        tab === 'book' ? (
          <div className="form-footer">
            <div className="spacer" />
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" form="book-form" className="btn-primary">
              保存
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="add-modal-tabs mode-toggle" role="tablist" aria-label="添加类型">
        {(Object.keys(TAB_LABELS) as AddTab[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
          >
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>
      {tab === 'book' ? <BookFormFields onClose={onClose} /> : <SeriesView />}
    </Modal>
  )
}