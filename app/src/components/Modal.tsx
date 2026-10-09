import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
  side,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** Optional panel shown beside the form (below it on narrow screens). */
  side?: ReactNode
}) {
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className={'modal' + (side ? ' wide' : '')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {side ? (
          <div className="modalcols">
            <div className="modalmain">{children}</div>
            <aside className="modalside">{side}</aside>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
