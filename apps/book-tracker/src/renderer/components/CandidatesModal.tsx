// v2.x 候选剧集 modal —— 独立于 SettingsPanel 的入口。
//
// 设计要点：
// - 与 SettingsPanel 解耦：不再「打开设置看候选」二合一；候选有自己的顶栏按钮
// - 复用 CandidatesSection 作为 body（密集列表 + 三按钮 + 空态文案不变）
// - 打开时按需 load：首次打开拉一次，后续打开复用 store 已有数据（避免闪烁）
// - modal width = 480（候选列表窄而长，不需要宽屏）；max-height 由 modal 自带 85vh 兜底

import { useEffect } from 'react'
import { Modal } from './Modal'
import { CandidatesSection } from './CandidatesSection'
import { useCandidatesStore } from '../store/candidates'

interface CandidatesModalProps {
  onClose: () => void
}

export function CandidatesModal({ onClose }: CandidatesModalProps): JSX.Element {
  const load = useCandidatesStore((s) => s.load)
  // 已加载过（items 有 / error 有）就不重拉，避免每次开关都重置成 loading 闪烁
  const alreadyLoaded = useCandidatesStore((s) => s.items.length > 0 || s.error !== null)
  useEffect(() => {
    if (!alreadyLoaded) void load()
  }, [alreadyLoaded, load])

  return (
    <Modal
      title="待选剧集"
      onClose={onClose}
      width={480}
      className="candidates-modal"
    >
      <CandidatesSection />
    </Modal>
  )
}