import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CodexClient } from '../codex/client.ts'
import { resolveSource, type KnownPapers } from './resolve.ts'

const NONE: KnownPapers = { byArxivId: () => null, bySourceUrl: () => null }

/** turn/start に対して決められた JSON を返す、最小の代役。 */
function fakeCodex(finalText: string): CodexClient {
  const listeners = new Set<{ notify: (n: { method: string; params?: unknown }) => void }>()
  const client = {
    onThread(_threadId: string, listener: { notify: (n: { method: string; params?: unknown }) => void }) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async request(method: string, params?: unknown) {
      if (method === 'thread/start') return { threadId: 'th_1' }
      if (method === 'turn/start') {
        const threadId = (params as { threadId: string }).threadId
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener.notify({
              method: 'item/completed',
              params: { threadId, item: { type: 'agentMessage', id: 'm1', text: finalText, phase: 'final_answer' } },
            })
            listener.notify({ method: 'turn/completed', params: { threadId, turn: { id: 't1', status: 'completed' } } })
          }
        })
        return {}
      }
      return {}
    },
  }
  return client as unknown as CodexClient
}

const AGENT_JSON = JSON.stringify({
  originalUrl: 'https://example.org/paper.pdf',
  kind: 'pdf',
  title: 'Instant Neural Graphics Primitives',
  authors: ['Thomas Müller'],
  year: 2022,
  venue: 'SIGGRAPH',
  abstract: '要旨',
  arxivId: null,
  slugKeyword: 'instant-ngp',
})

test('既に同じ URL で取り込んだ論文は重複として返る', async () => {
  const outcome = await resolveSource('https://arxiv.org/abs/2003.08934', {
    codex: fakeCodex(AGENT_JSON),
    model: 'test',
    known: { ...NONE, bySourceUrl: (u) => (u.includes('2003.08934') ? 'mildenhall2020-nerf' : null) },
  })
  assert.deepEqual(outcome, { kind: 'duplicate', slug: 'mildenhall2020-nerf', reason: 'sourceUrl' })
})

test('同じ arXiv 識別子の論文は、URL の形が違っても重複として返る', async () => {
  const outcome = await resolveSource('https://arxiv.org/pdf/2003.08934v2', {
    codex: fakeCodex(AGENT_JSON),
    model: 'test',
    known: { ...NONE, byArxivId: (id) => (id === '2003.08934' ? 'mildenhall2020-nerf' : null) },
  })
  assert.deepEqual(outcome, { kind: 'duplicate', slug: 'mildenhall2020-nerf', reason: 'arxivId' })
})

test('未知の出所はエージェントが解決する', async () => {
  const outcome = await resolveSource('https://example.org/project/', {
    codex: fakeCodex(AGENT_JSON),
    model: 'test',
    known: NONE,
  })
  assert.equal(outcome.kind, 'resolved')
  if (outcome.kind !== 'resolved') return
  assert.equal(outcome.source.via, 'agent')
  assert.equal(outcome.source.originalUrl, 'https://example.org/paper.pdf')
  assert.equal(outcome.source.title, 'Instant Neural Graphics Primitives')
  assert.equal(outcome.source.venue, 'SIGGRAPH')
  assert.equal(outcome.source.slugKeyword, 'instant-ngp')
})

test('エージェントが見つけた arXiv 識別子でも重複を判定する', async () => {
  const json = JSON.stringify({ ...JSON.parse(AGENT_JSON), arxivId: '2201.05989' })
  const outcome = await resolveSource('https://example.org/project/', {
    codex: fakeCodex(json),
    model: 'test',
    known: { ...NONE, byArxivId: (id) => (id === '2201.05989' ? 'muller2022-instant-ngp' : null) },
  })
  assert.deepEqual(outcome, { kind: 'duplicate', slug: 'muller2022-instant-ngp', reason: 'arxivId' })
})

test('JSON として読めない応答は失敗にする', async () => {
  await assert.rejects(
    resolveSource('https://example.org/project/', {
      codex: fakeCodex('見つかりませんでした'),
      model: 'test',
      known: NONE,
    }),
    /URL を解決できなかった/,
  )
})

test('必須の項目が欠けた応答は失敗にする', async () => {
  await assert.rejects(
    resolveSource('https://example.org/project/', {
      codex: fakeCodex(JSON.stringify({ title: 'タイトルだけ' })),
      model: 'test',
      known: NONE,
    }),
    /URL を解決できなかった/,
  )
})
