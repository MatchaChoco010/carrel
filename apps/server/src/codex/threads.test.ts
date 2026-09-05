import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forkThread } from '../chat/branch.ts'
import type { CodexClient } from './client.ts'
import { resumeThread, runTurn, startConversationThread, withWorkThread } from './threads.ts'

/** 投げられた要求を控えるだけの代役。 */
function recorder(fail = false): { client: CodexClient; sent: Array<{ method: string; params: unknown }> } {
  const sent: Array<{ method: string; params: unknown }> = []
  const client = {
    async request(method: string, params?: unknown) {
      sent.push({ method, params })
      if (fail) throw new Error('スレッドが残っていない')
      if (method === 'thread/start') return { threadId: 'th_1' }
      if (method === 'thread/fork') return { thread: { id: 'th_2' } }
      return {}
    },
  }
  return { client: client as unknown as CodexClient, sent }
}

const MCP_URL = 'http://127.0.0.1:7817/mcp'

test('スレッドを立てるときに道具を渡す', async () => {
  const { client, sent } = recorder()
  await startConversationThread(client, { dataDir: '/data', model: 'gpt-5.6-sol', mcpUrl: MCP_URL })
  const params = sent[0]?.params as { config?: { mcp_servers?: Record<string, { url: string }> } }
  assert.equal(params.config?.mcp_servers?.['carrel']?.url, MCP_URL)
})

test('読み込み直すときにも道具を渡す(#277)', async () => {
  const { client, sent } = recorder()
  assert.equal(await resumeThread(client, 'th_1', { mcpUrl: MCP_URL }), true)
  assert.equal(sent[0]?.method, 'thread/resume')
  const params = sent[0]?.params as { threadId: string; config?: { mcp_servers?: Record<string, { url: string }> } }
  assert.equal(params.threadId, 'th_1')
  assert.equal(params.config?.mcp_servers?.['carrel']?.url, MCP_URL)
})

test('道具の場所を渡さなければ、余計な設定を送らない', async () => {
  const { client, sent } = recorder()
  await resumeThread(client, 'th_1')
  assert.deepEqual(sent[0]?.params, { threadId: 'th_1' })
})

test('残っていないスレッドは false になる', async () => {
  const { client } = recorder(true)
  assert.equal(await resumeThread(client, 'th_1', { mcpUrl: MCP_URL }), false)
})

test('写して分けるときにも道具を渡す(#313)', async () => {
  const { client, sent } = recorder()
  await forkThread(client, 'th_1', 'turn_3', MCP_URL)

  assert.equal(sent[0]?.method, 'thread/fork')
  const params = sent[0]?.params as {
    threadId: string
    lastTurnId: string
    config?: { mcp_servers?: Record<string, { url: string }> }
  }
  assert.equal(params.threadId, 'th_1')
  assert.equal(params.lastTurnId, 'turn_3')
  assert.equal(params.config?.mcp_servers?.['carrel']?.url, MCP_URL)
})

/** ターンの通知を順に流す代役。`turn/completed` の中身を差し替えられる。 */
function turnRunner(turns: Array<{ status: string; error?: { message: string } }>): {
  client: CodexClient
  calls: () => number
} {
  let at = 0
  const handlers: Array<(n: { method: string; params: unknown }) => void> = []
  const client = {
    onThread(_id: string, hooks: { notify: (n: { method: string; params: unknown }) => void }) {
      handlers.push(hooks.notify)
      return () => {
        const i = handlers.indexOf(hooks.notify)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    async request(method: string) {
      if (method !== 'turn/start') return {}
      const turn = turns[Math.min(at, turns.length - 1)]
      at += 1
      queueMicrotask(() => {
        for (const notify of [...handlers]) {
          notify({ method: 'item/completed', params: { item: { type: 'agentMessage', phase: 'final_answer', text: '{}' } } })
          notify({ method: 'turn/completed', params: { turn } })
        }
      })
      return {}
    },
  }
  return { client: client as unknown as CodexClient, calls: () => at }
}

test('完了したターンはそのまま返る(#325)', async () => {
  const { client } = turnRunner([{ status: 'completed' }])
  const outcome = await runTurn(client, { threadId: 'th_1', input: [] }, { retryDelaysMs: [] })
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.text, '{}')
})

test('完了しなかったターンは、空の本文を返さず投げる(#325)', async () => {
  const { client } = turnRunner([{ status: 'failed', error: { message: 'Selected model is at capacity.' } }])
  await assert.rejects(
    () => runTurn(client, { threadId: 'th_1', input: [] }, { retryDelaysMs: [] }),
    (error: Error) => {
      assert.equal(error.name, 'TurnFailedError')
      // 論文の問題ではなく Codex の問題だと分かる文言にする。
      assert.match(error.message, /Codex がターンを完了できなかった/)
      assert.match(error.message, /at capacity/)
      return true
    },
  )
})

test('理由が添えられていなくても、Codex の問題だと分かる(#325)', async () => {
  const { client } = turnRunner([{ status: 'interrupted' }])
  await assert.rejects(
    () => runTurn(client, { threadId: 'th_1', input: [] }, { retryDelaysMs: [] }),
    (error: Error) => {
      assert.match(error.message, /Codex がターンを完了できなかった。時間を置いてやり直すこと。$/)
      return true
    },
  )
})

test('使い捨てのスレッドは、仕事が終わったら降ろす(#333)', async () => {
  const { client, sent } = recorder()
  const got = await withWorkThread(client, { instructions: '指示', model: 'gpt-5.4-mini' }, async (threadId) => {
    assert.equal(threadId, 'th_1')
    assert.equal(sent.length, 1)
    return 'できた'
  })
  assert.equal(got, 'できた')
  assert.deepEqual(
    sent.map((s) => s.method),
    ['thread/start', 'thread/delete'],
  )
  assert.deepEqual(sent[1]?.params, { threadId: 'th_1' })
})

test('使い捨てのスレッドは ephemeral にしない。ephemeral だと降ろせない(#333)', async () => {
  const { client, sent } = recorder()
  await withWorkThread(client, { instructions: '指示', model: 'gpt-5.4-mini' }, async () => undefined)
  const params = sent[0]?.params as { ephemeral?: boolean }
  assert.equal(params.ephemeral, undefined)
})

test('仕事が失敗しても降ろしてから投げる(#333)', async () => {
  const { client, sent } = recorder()
  await assert.rejects(
    () =>
      withWorkThread(client, { instructions: '指示', model: 'gpt-5.4-mini' }, async () => {
        throw new Error('形の違う応答')
      }),
    /形の違う応答/,
  )
  assert.equal(sent[1]?.method, 'thread/delete')
})

test('降ろせなくても仕事の結果は返す(#333)', async () => {
  const sent: string[] = []
  const client = {
    async request(method: string) {
      sent.push(method)
      if (method === 'thread/start') return { threadId: 'th_1' }
      throw new Error('app-server が起動していない')
    },
  } as unknown as CodexClient
  const warn = console.warn
  const warned: string[] = []
  console.warn = (message: string) => warned.push(message)
  try {
    const got = await withWorkThread(client, { instructions: '指示', model: 'gpt-5.4-mini' }, async () => 'できた')
    assert.equal(got, 'できた')
  } finally {
    console.warn = warn
  }
  assert.deepEqual(sent, ['thread/start', 'thread/delete'])
  assert.match(warned[0] ?? '', /降ろせなかった/)
})
