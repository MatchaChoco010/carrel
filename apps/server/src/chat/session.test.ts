import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CodexClient } from '../codex/client.ts'
import { ChatSessions, type ChatState } from './session.ts'
import type { InstructionStore } from './instruction-store.ts'

/**
 * thread/read に答えるだけの代役。どのスレッドを訊かれたかを控える。
 *
 * 残っているかは載せずに確かめる(#335)。resume が来たら、確かめるだけの経路で
 * 会話を載せてしまっているので、投げて落とす。
 */
function sessions(alive: (threadId: string) => boolean): { chats: ChatSessions; resumed: string[] } {
  const resumed: string[] = []
  const client = {
    async request(method: string, params?: unknown) {
      if (method === 'thread/resume') throw new Error('確かめるだけなのに載せた')
      if (method !== 'thread/read') return {}
      const threadId = (params as { threadId: string }).threadId
      resumed.push(threadId)
      if (!alive(threadId)) throw new Error('スレッドが残っていない')
      return {}
    },
  }
  const chats = new ChatSessions({
    dataDir: '/data',
    codex: client as unknown as CodexClient,
    createChat: async () => ({ absolutePath: '/data/chat.md', id: 'c1' }),
    knownSlug: () => false,
    mcpUrl: 'http://127.0.0.1:7817/mcp',
    defaults: () => ({ model: 'gpt-5.6-sol', effort: 'medium' }),
    instructions: () => '',
    inForce: { get: () => null, set: () => undefined } as unknown as InstructionStore,
    onEvent: () => undefined,
    reindex: async () => undefined,
  })
  return { chats, resumed }
}

/** 一覧を返した後の調べが終わるまで待つ。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

test('調べる前の一覧は Codex に触らない(#327)', () => {
  const { chats, resumed } = sessions(() => true)
  assert.equal(chats.knownStateOfThread('th_1'), null)
  assert.deepEqual(resumed, [])
})

test('スレッドを持たない会話は、調べるまでもなく new(#327)', () => {
  const { chats, resumed } = sessions(() => true)
  assert.equal(chats.knownStateOfThread(null), 'new')
  assert.deepEqual(resumed, [])
})

test('後ろで調べた結果を、分かった順に知らせる(#327)', async () => {
  const { chats, resumed } = sessions((threadId) => threadId === 'th_1')
  const told: Array<{ threadId: string; state: ChatState }> = []
  chats.resolveStates(['th_1', 'th_2', null], (threadId, state) => told.push({ threadId, state }))
  await settle()

  assert.deepEqual(resumed, ['th_1', 'th_2'])
  assert.deepEqual(told, [
    { threadId: 'th_1', state: 'resumable' },
    { threadId: 'th_2', state: 'needsReload' },
  ])
  assert.equal(chats.knownStateOfThread('th_1'), 'resumable')
  assert.equal(chats.knownStateOfThread('th_2'), 'needsReload')
})

test('一度調べたスレッドは、一覧を開き直しても投げ直さない(#327)', async () => {
  const { chats, resumed } = sessions(() => true)
  chats.resolveStates(['th_1'], () => undefined)
  await settle()
  chats.resolveStates(['th_1'], () => undefined)
  await settle()

  assert.deepEqual(resumed, ['th_1'])
})

test('調べている最中に一覧を開き直しても、二重に投げない(#327)', async () => {
  const { chats, resumed } = sessions(() => true)
  chats.resolveStates(['th_1'], () => undefined)
  chats.resolveStates(['th_1'], () => undefined)
  await settle()

  assert.deepEqual(resumed, ['th_1'])
})
