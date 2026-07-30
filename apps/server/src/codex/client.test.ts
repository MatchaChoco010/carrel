import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CodexClient } from './client.ts'
import type { Notification } from './protocol.ts'

const FAKE = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url))

function client(): CodexClient {
  return new CodexClient({ command: process.execPath, args: [FAKE], requestTimeoutMs: 5_000 })
}

/** 偽 app-server に通知を 1 つ流させる。 */
function notify(codex: CodexClient, method: string, params: unknown): Promise<unknown> {
  return codex.request('test/notify', { method, params })
}

test('スレッド宛の通知は、待っている側だけに配る', async () => {
  const codex = client()
  await codex.start()
  try {
    const mine: Notification[] = []
    const others: Notification[] = []
    codex.onThread('T1', { notify: (n) => mine.push(n), fail: () => {} })
    codex.onThread('T2', { notify: (n) => others.push(n), fail: () => {} })

    await notify(codex, 'turn/started', { threadId: 'T1' })

    assert.equal(mine.length, 1)
    assert.equal(others.length, 0)
  } finally {
    await codex.stop()
  }
})

test('外した後は配らない', async () => {
  const codex = client()
  await codex.start()
  try {
    const seen: Notification[] = []
    const off = codex.onThread('T1', { notify: (n) => seen.push(n), fail: () => {} })

    await notify(codex, 'turn/started', { threadId: 'T1' })
    off()
    await notify(codex, 'turn/completed', { threadId: 'T1' })

    assert.equal(seen.length, 1)
  } finally {
    await codex.stop()
  }
})

test('同時に流すターンが増えても listener は増えない', async () => {
  const codex = client()
  await codex.start()
  try {
    for (let i = 0; i < 20; i += 1) codex.onThread(`T${i}`, { notify: () => {}, fail: () => {} })

    assert.equal(codex.listenerCount('notification'), 0, 'ターンごとに EventEmitter へ足さない')
  } finally {
    await codex.stop()
  }
})

test('app-server が落ちたら、通知を待っている側に知らせる', async () => {
  const codex = client()
  await codex.start()

  const failures: Error[] = []
  codex.onThread('T1', { notify: () => {}, fail: (error) => failures.push(error) })

  await codex.request('test/exit', {}).catch(() => {})
  // 終了の通知が届くまで待つ。
  await new Promise((resolve) => setTimeout(resolve, 200))

  assert.equal(failures.length, 1)
  assert.match(failures[0]?.message ?? '', /app-server が終了した/)
})
