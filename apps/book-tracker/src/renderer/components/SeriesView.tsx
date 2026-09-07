// 系列管理视图(v1.8 起)—— 从原 SeriesModal 抽出,作为 AddModal「系列」tab 的内容。
//
// **为什么抽出来**:与 BookFormFields 同款 —— AddModal 自身是一个 Modal,内容
// 必须不含 Modal 包装,否则 Modal 内嵌 Modal。本组件只负责 series 的 list+CRUD
// 主体,Modal 包装由 AddModal 提供。
//
// **v2.x 简化**:本 tab 现在只承担"新建系列"入口 —— 已添加系列的管理
// (edit / delete / 添加成员)统一走编辑模式侧栏(SidebarSeriesView),不在
// AddModal 内重复列表 + 按钮。理由:用户诉求"添加那边 + 系列不需要把那些已经
// 添加的系列都列举在里面,就简单的最上面那一行就够了" —— AddModal 是「创建」
// 入口,管理是「消费」入口,职责分离更清晰。
//
// **Modal 包装**:AddModal 是 v1.8 起唯一 Modal,本组件不含 Modal 包装
// (BookFormFields 同款)。
//
// **共享边界**:领域专属 UI,留 app。

import { useState } from 'react'
import { useSeriesStore } from '../store/series'

export function SeriesView(): JSX.Element {
  const createSeries = useSeriesStore((s) => s.create)
  // 计数用 —— App.tsx 已在启动时 loadSeries,SeriesView 直接读 store 即可
  const seriesList = useSeriesStore((s) => s.series)

  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | null>(null)

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) {
      setNewError('系列名不能为空')
      return
    }
    setNewError(null)
    try {
      await createSeries({ name: newName.trim(), notes: '' })
      setNewName('')
    } catch (e) {
      setNewError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="series-modal-body">
      <div className="series-create">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新系列名 (例:三体、大明王朝)"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreate()
            }
          }}
          autoFocus
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleCreate()}
          disabled={!newName.trim()}
        >
          + 新建
        </button>
        {newError && <span className="error">{newError}</span>}
      </div>

      <p className="muted series-existing-hint">
        {seriesList.length === 0
          ? '还没有系列 —— 在上面输入名字 + 「+ 新建」开始'
          : `已有 ${seriesList.length} 个系列 —— 在编辑模式左栏查看 / 管理成员`}
      </p>
    </div>
  )
}
