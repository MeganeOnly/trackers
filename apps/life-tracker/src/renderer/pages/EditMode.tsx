import { GoalList } from '../components/GoalList'
import { GoalDetail } from '../components/GoalDetail'

export function EditMode(): JSX.Element {
  return (
    <div className="page-edit">
      <aside className="sidebar">
        <GoalList />
      </aside>
      <main className="detail-panel">
        <GoalDetail />
      </main>
    </div>
  )
}
