import assert from 'node:assert/strict'
import test from 'node:test'
import { turnAfterLoad, type Turn } from './chat-turn.ts'

const writing = (delta: string): Turn => ({ id: 'c1', delta, phase: 'writing' })

test('走っていなければ、出している応答を片付ける', () => {
  assert.equal(turnAfterLoad(writing('途中まで'), { id: 'c1', running: false, partial: null }, true), null)
})

test('開き直したときは、サーバーが持っている本文を土台にする(#262)', () => {
  const turn = turnAfterLoad(null, { id: 'c1', running: true, partial: 'ここまで書いた' }, true)
  assert.deepEqual(turn, { id: 'c1', delta: 'ここまで書いた', phase: 'writing' })
})

test('読んでいる間に届いた差分は、土台の後ろに残る(#262)', () => {
  const turn = turnAfterLoad(writing('その続き'), { id: 'c1', running: true, partial: 'ここまで書いた' }, true)
  assert.equal(turn?.delta, 'ここまで書いたその続き')
})

test('開いたままの読み直しでは、土台を付けない(#262)', () => {
  const turn = turnAfterLoad(writing('ここまで書いた'), { id: 'c1', running: true, partial: 'ここまで書いた' }, false)
  assert.equal(turn?.delta, 'ここまで書いた')
})

test('開いたままの読み直しで応答を持たないときは、空から始める', () => {
  const turn = turnAfterLoad(null, { id: 'c1', running: true, partial: 'ここまで書いた' }, false)
  assert.deepEqual(turn, { id: 'c1', delta: '', phase: 'writing' })
})

test('土台が無い(まだ何も書かれていない)ときも開き直せる', () => {
  const turn = turnAfterLoad(null, { id: 'c1', running: true, partial: null }, true)
  assert.deepEqual(turn, { id: 'c1', delta: '', phase: 'writing' })
})

test('送った直後の印は、開き直すと応答を作っている印に変わる', () => {
  const sending: Turn = { id: 'c1', delta: '', phase: 'sending' }
  const turn = turnAfterLoad(sending, { id: 'c1', running: true, partial: '' }, true)
  assert.equal(turn?.phase, 'writing')
})
