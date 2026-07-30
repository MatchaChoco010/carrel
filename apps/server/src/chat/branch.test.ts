import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '../data/chat.ts'
import { toIsoDateTime } from '../data/datetime.ts'
import { inherited } from './branch.ts'

const AT = toIsoDateTime(new Date('2026-07-30T08:24:40+09:00'))

function turns(count: number): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let at = 1; at <= count; at += 1) {
    messages.push({ role: 'user', at, text: `質問${at}` } as unknown as ChatMessage)
    messages.push({ role: 'assistant', at: AT, text: `応答${at}`, turnId: `turn-${at}` })
  }
  return messages.map((m) => ({ ...m, at: AT }))
}

test('ユーザーの発言を選ぶと、その turn の 1 つ前までを引き継ぐ', () => {
  const messages = turns(3)

  const kept = inherited(messages, 4)

  assert.deepEqual(
    kept?.map((m) => m.text),
    ['質問1', '応答1', '質問2', '応答2'],
  )
})

test('応答を選ぶと、その turn の 1 つ前までを引き継ぐ', () => {
  const messages = turns(3)

  const kept = inherited(messages, 5)

  assert.deepEqual(
    kept?.map((m) => m.text),
    ['質問1', '応答1', '質問2', '応答2'],
  )
})

test('引き継ぐ範囲は必ず応答で終わる', () => {
  const messages = turns(3)

  for (const selected of [2, 3, 4, 5]) {
    const kept = inherited(messages, selected)
    assert.equal(kept?.[kept.length - 1]?.role, 'assistant')
  }
})

test('最初の turn は分岐点にしない', () => {
  const messages = turns(2)

  assert.equal(inherited(messages, 0), null)
  assert.equal(inherited(messages, 1), null)
})

test('範囲の外を選んだら分岐しない', () => {
  const messages = turns(2)

  assert.equal(inherited(messages, -1), null)
  assert.equal(inherited(messages, 4), null)
})

test('応答が残らなかった turn を挟んでも、直前の応答まで戻る', () => {
  const messages: ChatMessage[] = [
    { role: 'user', at: AT, text: '質問1' },
    { role: 'assistant', at: AT, text: '応答1', turnId: 'turn-1' },
    { role: 'user', at: AT, text: '答えが返らなかった質問' },
    { role: 'user', at: AT, text: '質問2' },
  ]

  const kept = inherited(messages, 3)

  assert.deepEqual(
    kept?.map((m) => m.text),
    ['質問1', '応答1'],
  )
})
