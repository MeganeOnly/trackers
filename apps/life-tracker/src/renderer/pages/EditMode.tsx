import { GoalList } from '../components/GoalList'
import { GoalDetail } from '../components/GoalDetail'

interface EditModeProps {
  onEdit: () => void
}

export function EditMode({ onEdit }: EditModeProps): JSX.Element {
  return (
    <div className="page-edit">
      <aside className="sidebar">
        <GoalList />
      </aside>
      <main className="detail-panel">
        <GoalDetail onEdit={onEdit} />
      </main>
    </div>
  )
}
