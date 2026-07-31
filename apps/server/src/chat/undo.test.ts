import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '../data/chat.ts'
import { lastAsked } from './undo.ts'

const at = '2026-07-31T10:00:00+09:00' as ChatMessage['at']

function messages(roles: Array<'user' | 'assistant'>): ChatMessage[] {
  return roles.map((role, index) => ({ role, at, text: `${role} ${index}` }))
}

test('末尾のユーザーの発言を指す', () => {
  assert.equal(lastAsked(messages(['user', 'assistant', 'user', 'assistant'])), 2)
})

test('応答がまだ返っていなければ、その発言を指す', () => {
  assert.equal(lastAsked(messages(['user', 'assistant', 'user'])), 2)
})

test('ユーザーの発言が無ければ -1 になる', () => {
  assert.equal(lastAsked([]), -1)
  assert.equal(lastAsked(messages(['assistant'])), -1)
})
