import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CodexClient } from './client.ts'
import { resumeThread, startConversationThread } from './threads.ts'

/** 投げられた要求を控えるだけの代役。 */
function recorder(fail = false): { client: CodexClient; sent: Array<{ method: string; params: unknown }> } {
  const sent: Array<{ method: string; params: unknown }> = []
  const client = {
    async request(method: string, params?: unknown) {
      sent.push({ method, params })
      if (fail) throw new Error('スレッドが残っていない')
      if (method === 'thread/start') return { threadId: 'th_1' }
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
  assert.equal(params.config?.mcp_servers?.['pct']?.url, MCP_URL)
})

test('読み込み直すときにも道具を渡す(#277)', async () => {
  const { client, sent } = recorder()
  assert.equal(await resumeThread(client, 'th_1', { mcpUrl: MCP_URL }), true)
  assert.equal(sent[0]?.method, 'thread/resume')
  const params = sent[0]?.params as { threadId: string; config?: { mcp_servers?: Record<string, { url: string }> } }
  assert.equal(params.threadId, 'th_1')
  assert.equal(params.config?.mcp_servers?.['pct']?.url, MCP_URL)
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
