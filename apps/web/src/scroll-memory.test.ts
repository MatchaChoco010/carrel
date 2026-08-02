import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScrollMemory, type ScrollBox } from './scroll-memory.ts'

/** 送る枠の代役。`scrollTop` を書き替えたら scroll が飛ぶところまでを真似る。 */
function box(): ScrollBox & { scroll: (to: number) => void; listeners: number } {
  const listeners = new Set<() => void>()
  return {
    scrollTop: 0,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    scroll(to: number) {
      this.scrollTop = to
      for (const listener of listeners) listener()
    },
    get listeners() {
      return listeners.size
    },
  }
}

test('外れて戻ると、送っていた位置へ戻す(#292)', () => {
  const memory = createScrollMemory()
  const first = box()
  memory.attach(first)
  first.scroll(820)

  // 論文を開く。一覧が外れ、枠の中身は詳細に入れ替わる。
  memory.attach(null)
  first.scrollTop = 0

  memory.attach(first)
  assert.equal(first.scrollTop, 820)
})

test('外れた後の送りは覚えない(#292)', () => {
  const memory = createScrollMemory()
  const target = box()
  memory.attach(target)
  target.scroll(400)
  memory.attach(null)

  // 詳細を送っても、一覧の位置は動かない。
  target.scroll(1200)
  assert.equal(memory.offset, 400)
})

test('外れたときに見張りを外す(#292)', () => {
  const memory = createScrollMemory()
  const target = box()
  memory.attach(target)
  assert.equal(target.listeners, 1)
  memory.attach(null)
  assert.equal(target.listeners, 0)
})

test('枠が入れ替わっても位置を持ち越す(#292)', () => {
  const memory = createScrollMemory()
  const before = box()
  memory.attach(before)
  before.scroll(300)

  // タブを開き直すと、一覧は別の枠の中に出る。
  const after = box()
  memory.attach(after)
  assert.equal(after.scrollTop, 300)
  assert.equal(before.listeners, 0)
})

test('まだ送っていなければ先頭のまま(#292)', () => {
  const memory = createScrollMemory()
  const target = box()
  target.scrollTop = 500
  memory.attach(target)
  assert.equal(target.scrollTop, 0)
  assert.equal(memory.offset, 0)
})
