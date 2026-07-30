import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMessages, serializeMessages, withoutTurnIds, type ChatMessage } from './chat.ts'
import { toIsoDateTime } from './datetime.ts'

const AT = toIsoDateTime(new Date('2026-07-30T08:24:40+09:00'))
const TURN = '019fb103-f2e8-7ce3-98dd-43fcda467f7e'

test('応答の見出しから turn の識別子を読む', () => {
  const body = [`## user · ${AT}`, '', '質問', '', `## assistant · ${AT} · turn ${TURN}`, '', '応答'].join('\n')

  const messages = parseMessages(body)

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.turnId, undefined, 'ユーザーの発言には付かない')
  assert.equal(messages[1]?.turnId, TURN)
  assert.equal(messages[1]?.text, '応答')
})

test('識別子の無い見出しもそのまま読める', () => {
  const body = [`## assistant · ${AT}`, '', '応答'].join('\n')

  const messages = parseMessages(body)

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.turnId, undefined)
})

test('書き出した記録を読み直すと同じ発言になる', () => {
  const messages: ChatMessage[] = [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答', turnId: TURN },
  ]

  assert.deepEqual(parseMessages(serializeMessages(messages)), messages)
})

test('識別子を持たない発言の見出しには turn を書かない', () => {
  const text = serializeMessages([{ role: 'assistant', at: AT, text: '応答' }])

  assert.equal(text.includes('turn'), false)
})

test('本文に発言の見出しに似た行があっても区切りにしない', () => {
  const body = [`## assistant · ${AT} · turn ${TURN}`, '', '例を挙げる。', '', '## user · きのう', '', 'ここまで応答'].join(
    '\n',
  )

  const messages = parseMessages(body)

  assert.equal(messages.length, 1)
  assert.match(messages[0]?.text ?? '', /ここまで応答/)
})

test('識別子だけを落とし、本文と時刻は変えない', () => {
  const messages: ChatMessage[] = [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答', turnId: TURN },
  ]

  const dropped = withoutTurnIds(messages)

  assert.deepEqual(dropped, [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答' },
  ])
})
