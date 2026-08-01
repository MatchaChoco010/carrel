import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { authorLine, type Mention } from '../paper-mention.ts'

export type PaperMentionProps = {
  mention: Mention
}

/** ツールチップと画面の端の間に空ける幅(px)。 */
const MARGIN = 8

/** マウスが参照から離れてからツールチップを消すまで(ms)。中の slug を押しに行ける長さにする。 */
const LINGER = 200

type Placement = { left: number; top: number }

/** 参照の下に置く。画面の下辺に収まらなければ上へ回し、横は画面の中へ寄せる。 */
function place(anchor: DOMRect, card: DOMRect): Placement {
  const up = anchor.bottom + card.height + MARGIN > window.innerHeight
  return {
    left: Math.min(Math.max(MARGIN, anchor.left), window.innerWidth - card.width - MARGIN),
    top: up ? anchor.top - card.height - 4 : anchor.bottom + 4,
  }
}

/**
 * チャットの本文に出す論文の参照(0024)。
 *
 * 本文には `@Wang 2026a` の短い形を出し、指したときに題と正式な slug を見せる。
 *
 * ツールチップを画面の直下ではなく `document.body` へ出すのは、会話の欄と表がそれぞれ
 * 中でスクロールするためである。その中に置くと、枠の縁で切られて読めなくなる。
 */
export function PaperMention({ mention }: PaperMentionProps) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<Placement | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const card = useRef<HTMLSpanElement | null>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hold = useCallback((): void => {
    if (closing.current !== null) clearTimeout(closing.current)
    closing.current = null
  }, [])
  const release = useCallback((): void => {
    hold()
    closing.current = setTimeout(() => setOpen(false), LINGER)
  }, [hold])

  useEffect(() => () => hold(), [hold])

  // 出してから中身の大きさが決まるので、置き場所は描いた後に測って決める。
  useEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const from = anchor.current?.getBoundingClientRect()
    const box = card.current?.getBoundingClientRect()
    if (from === undefined || box === undefined) return
    setAt(place(from, box))
  }, [open])

  // 画面が動くと参照から離れてしまうので、そのときは消す。
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // 触って使うときは、外を触ると閉じる。
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (anchor.current?.contains(target) === true) return
      if (card.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <span className="mention">
      <button
        ref={anchor}
        type="button"
        className="mention__name"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return
          hold()
          setOpen(true)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') release()
        }}
      >
        @{mention.name}
      </button>
      {open &&
        createPortal(
          <span
            ref={card}
            className="mention__card"
            role="tooltip"
            // 測る前は置き場所が決まらないので、画面の外へ置いて見せない。
            style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }}
            onPointerEnter={hold}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') release()
            }}
          >
            <span className="mention__title">{mention.title}</span>
            <span className="mention__authors">{authorLine(mention)}</span>
            <span className="mention__slug">@{mention.slug}</span>
          </span>,
          document.body,
        )}
    </span>
  )
}
