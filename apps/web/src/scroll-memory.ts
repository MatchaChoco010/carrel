/**
 * 一覧の送り位置を、外れている間だけ覚えておく(#292)。
 *
 * 論文を開くと一覧は丸ごと外れ、送っている枠の中身が短い詳細に入れ替わる。
 * そのとき枠の `scrollTop` は 0 に詰められるので、戻ってきたときに元の位置が残っていない。
 */

/** 送り位置を覚える相手。試験で差し替えられるように、要る口だけを並べる。 */
export type ScrollBox = {
  scrollTop: number
  addEventListener: (type: 'scroll', listener: () => void, options?: { passive: boolean }) => void
  removeEventListener: (type: 'scroll', listener: () => void) => void
}

export type ScrollMemory = {
  /**
   * 一覧が現れたら枠を渡し、外れたら null を渡す。
   *
   * 現れたときは覚えていた位置へ戻し、そこから先の送りを追い続ける。
   */
  attach: (box: ScrollBox | null) => void
  /** 覚えている位置。 */
  readonly offset: number
}

/**
 * 送り位置の覚え書きを作る。
 *
 * 外れる瞬間に読むのではなく、送られるたびに控える。外れる処理の中では枠の中身が
 * もう入れ替わっていることがあり、そのとき読んだ値は 0 になる。
 */
export function createScrollMemory(): ScrollMemory {
  let offset = 0
  let box: ScrollBox | null = null
  const remember = (): void => {
    if (box !== null) offset = box.scrollTop
  }
  return {
    attach: (next) => {
      box?.removeEventListener('scroll', remember)
      box = next
      if (next === null) return
      next.scrollTop = offset
      next.addEventListener('scroll', remember, { passive: true })
    },
    get offset() {
      return offset
    },
  }
}

/**
 * 送っている祖先を探す。
 *
 * 送る枠はタブごとに違うので、名前で選ばずに辿る。末尾と先頭の見張り(#222、#273)が
 * どの枠が送られているかを知らずに済ませているのと同じ理由である。
 */
export function scrollingParent(node: HTMLElement | null): HTMLElement | null {
  for (let parent = node?.parentElement ?? null; parent !== null; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
  }
  return null
}
