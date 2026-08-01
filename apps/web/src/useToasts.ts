import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastKind = 'info' | 'error'

export type Toast = {
  id: number
  kind: ToastKind
  text: string
}

/** 出したままにする長さ。読み切れて、作業の邪魔にならない程度にする。 */
export const TOAST_MS = 6000

/**
 * 画面の隅に数秒だけ出す知らせ(#229)。
 *
 * 押した結果が画面のどこにも出ないと、何が起きたのか分からない。取り込みのように
 * 結果が後から届くものは、届いた時点でここへ流す。
 */
export function useToasts(): {
  toasts: Toast[]
  notify: (text: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
} {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = next.current
      next.current += 1
      setToasts((previous) => [...previous, { id, kind, text }])
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        dismiss(id)
      }, TOAST_MS)
      timers.current.add(timer)
    },
    [dismiss],
  )

  // 画面を離れるときに残った待ちを片付ける。
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return { toasts, notify, dismiss }
}
