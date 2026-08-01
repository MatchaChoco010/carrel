import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CodexClient } from '../codex/client.ts'
import { judgeOriginal } from './judge.ts'

const ASKED = {
  title: 'Ray Tracing Massive Amounts of Animated Geometry',
  authors: ['Holger Gruen', 'Carsten Benthin'],
  year: 2026,
}

/** turn/start に対して決められた JSON を返す、最小の代役。渡した入力も控える。 */
function fakeCodex(finalText: string): { client: CodexClient; inputs: unknown[] } {
  const listeners = new Set<{ notify: (n: { method: string; params?: unknown }) => void }>()
  const inputs: unknown[] = []
  const client = {
    onThread(_threadId: string, listener: { notify: (n: { method: string; params?: unknown }) => void }) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async request(method: string, params?: unknown) {
      if (method === 'thread/start') return { threadId: 'th_1' }
      if (method === 'turn/start') {
        const asked = params as { threadId: string; input?: unknown }
        inputs.push(asked.input)
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener.notify({
              method: 'item/completed',
              params: {
                threadId: asked.threadId,
                item: { type: 'agentMessage', id: 'm1', text: finalText, phase: 'final_answer' },
              },
            })
            listener.notify({
              method: 'turn/completed',
              params: { threadId: asked.threadId, turn: { id: 't1', status: 'completed' } },
            })
          }
        })
        return {}
      }
      return {}
    },
  }
  return { client: client as unknown as CodexClient, inputs }
}

function judge(answer: string, head = { kind: 'text' as const, text: '本文の先頭' }) {
  const fake = fakeCodex(answer)
  return { run: judgeOriginal(head, ASKED, { codex: fake.client, model: 'test' }), inputs: fake.inputs }
}

test('同じ論文だと返れば、受け取ってよいと判じる(0025)', async () => {
  assert.deepEqual(await judge('{"same":true,"kind":"same","reason":""}').run, { same: true })
})

test('違う文書だと返れば、その理由を持って落とす(0025)', async () => {
  const judged = await judge(
    '{"same":false,"kind":"not-a-paper","reason":"企業の人権に関する声明であり、論文ではない。"}',
  ).run
  assert.deepEqual(judged, { same: false, reason: '企業の人権に関する声明であり、論文ではない。' })
})

test('理由が空でも、何であったかが分かる形にする(0025)', async () => {
  const judged = await judge('{"same":false,"kind":"related-document","reason":""}').run
  assert.equal(judged.same, false)
  assert.match((judged as { same: false; reason: string }).reason, /related-document/)
})

test('読めない答えは、判じられなかったこととして投げる(0025)', async () => {
  await assert.rejects(judge('これは JSON ではない').run, /判じられなかった/)
})

test('same を持たない答えも、判じられなかったこととして投げる(0025)', async () => {
  await assert.rejects(judge('{"kind":"same","reason":""}').run, /判じられなかった/)
})

test('頼んだ論文の書誌を問い合わせに載せる(0025)', async () => {
  const judged = judge('{"same":true,"kind":"same","reason":""}')
  await judged.run
  const text = JSON.stringify(judged.inputs)
  assert.match(text, /Ray Tracing Massive Amounts of Animated Geometry/)
  assert.match(text, /Holger Gruen/)
  assert.match(text, /2026/)
})

test('文字層が無いときは、ページの画像を渡す(0025)', async () => {
  const judged = judge('{"same":true,"kind":"same","reason":""}', {
    kind: 'images',
    files: ['/tmp/page-0.png', '/tmp/page-1.png'],
    dispose: async () => {},
  } as never)
  await judged.run
  const text = JSON.stringify(judged.inputs)
  assert.match(text, /page-0\.png/)
  assert.match(text, /page-1\.png/)
})
