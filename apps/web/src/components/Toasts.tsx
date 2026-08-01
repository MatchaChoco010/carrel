import { X } from 'lucide-react'
import type { Toast } from '../useToasts.ts'

export type ToastsProps = {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

const ICON = 14

/** 画面の右下に出す知らせ(#229)。数秒で消えるが、押しても消せる。 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__text">{toast.text}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="この知らせを消す">
            <X size={ICON} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
