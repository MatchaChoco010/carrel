import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'pct.split'
/** 一覧とチャットのどちらも読める幅を残すための下限と上限。 */
const MIN = 20
const MAX = 80

function stored(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) && value >= MIN && value <= MAX ? value : 50
}

export type Split = {
  /** 一覧の幅の割合。 */
  percent: number
  dragging: boolean
  onGrab: (event: { clientX: number; preventDefault: () => void }) => void
}

/**
 * 一覧とチャットの境目を掴んで動かせるようにする。
 *
 * 既定は半々で、動かした位置は次に開いたときも保つ。
 */
export function useSplit(container: React.RefObject<HTMLElement | null>): Split {
  const [percent, setPercent] = useState(stored)
  const [dragging, setDragging] = useState(false)

  const onGrab = useCallback((event: { clientX: number; preventDefault: () => void }) => {
    event.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (event: MouseEvent): void => {
      const element = container.current
      if (element === null) return
      // 位置はその場で反映する。次の描画へ持ち越すと、掴みを離した時点で
      // 保留中の更新が取り消され、最後の移動が失われる。
      const box = element.getBoundingClientRect()
      const next = ((event.clientX - box.left) / box.width) * 100
      setPercent(Math.min(MAX, Math.max(MIN, next)))
    }
    const up = (): void => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging, container])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(percent)))
  }, [percent])

  return { percent, dragging, onGrab }
}
