import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { CodexClient } from './client.ts'
import { METHODS } from './protocol.ts'
import { CodexService } from './service.ts'

/** app-server の代わり。要求への答えだけを差し替える。 */
class FakeClient extends EventEmitter {
  started = false
  readonly answer: (method: string) => Promise<unknown>

  constructor(answer: (method: string) => Promise<unknown>) {
    super()
    this.answer = answer
  }

  async start(): Promise<void> {
    this.started = true
  }

  request(method: string): Promise<unknown> {
    return this.answer(method)
  }
}

function service(answer: (method: string) => Promise<unknown>, events = {}) {
  const client = new FakeClient(answer)
  return { client, codex: new CodexService(events, client as unknown as CodexClient) }
}

test('残枠を読めなくても app-server は立ち上がったままにする', async () => {
  const failures: unknown[] = []
  const { client, codex } = service(
    () => Promise.reject(new Error('503 Service Unavailable')),
    { onRateLimitsUnavailable: (error: unknown) => failures.push(error) },
  )

  await codex.start()

  assert.equal(client.started, true)
  assert.equal(codex.rateLimits, null)
  assert.equal(failures.length, 1, '読めなかったことは知らせる')
})

test('残枠を読めたら保持して知らせる', async () => {
  const views: unknown[] = []
  const { codex } = service(
    (method) =>
      method === METHODS.rateLimitsRead
        ? Promise.resolve({ rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: null } } })
        : Promise.reject(new Error(`知らない要求: ${method}`)),
    { onRateLimits: (view: unknown) => views.push(view) },
  )

  await codex.start()

  assert.notEqual(codex.rateLimits, null)
  assert.equal(views.length, 1)
})
