import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StateDb } from '../db/state-db.ts'
import { JobQueue } from './queue.ts'
import { JobStore } from './store.ts'
import type { Job } from './types.ts'

type Harness = {
  root: string
  state: StateDb
  store: JobStore
  close: () => void
}

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'carrel-jobs-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  return {
    root,
    state,
    store: new JobStore(state.db),
    close: () => {
      state.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * 走り始めた順序を観察するための仕掛け。
 *
 * `openAll` の後に始まった仕事もすぐ終わるようにしておかないと、`drain` が
 * 待ち続ける。
 */
function gate() {
  const started: string[] = []
  const waiters: Array<() => void> = []
  let open = false

  const handler = async (job: Job): Promise<void> => {
    started.push(job.target)
    if (open) return
    await new Promise<void>((resolve) => waiters.push(resolve))
  }

  return {
    started,
    handler,
    releaseOne: (): void => waiters.shift()?.(),
    openAll: (): void => {
      open = true
      waiters.splice(0).forEach((resolve) => resolve())
    },
  }
}

/** 解決したジョブの後始末が進むまで待つ。 */
async function tick(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('GPU の仕事は 1 本ずつ順に走る', async () => {
  const h = makeHarness()
  try {
    const g = gate()
    const queue = new JobQueue(h.store)
    queue.register('convert', g.handler)
    queue.start()

    for (const target of ['a', 'b', 'c']) queue.enqueue({ kind: 'convert', target, resource: 'gpu' })

    assert.deepEqual(g.started, ['a'])
    assert.equal(h.store.runningCount('gpu'), 1)

    g.releaseOne()
    await tick()
    assert.deepEqual(g.started, ['a', 'b'])

    g.openAll()
    await queue.drain()
    assert.deepEqual(g.started, ['a', 'b', 'c'])
    assert.equal(h.store.counts().done, 3)
  } finally {
    h.close()
  }
})

test('待機中の背景ジョブより、後から積んだ前景ジョブが先に走る', async () => {
  const h = makeHarness()
  try {
    const g = gate()
    const queue = new JobQueue(h.store)
    queue.register('convert', g.handler)
    queue.start()

    queue.enqueue({ kind: 'convert', target: 'ふさぎ', resource: 'gpu' })
    queue.enqueue({ kind: 'convert', target: '背景1', resource: 'gpu', priority: 'background' })
    queue.enqueue({ kind: 'convert', target: '背景2', resource: 'gpu', priority: 'background' })
    queue.enqueue({ kind: 'convert', target: '前景', resource: 'gpu', priority: 'foreground' })

    assert.deepEqual(g.started, ['ふさぎ'])

    g.releaseOne()
    await tick()
    assert.deepEqual(g.started, ['ふさぎ', '前景'])

    g.openAll()
    await queue.drain()
  } finally {
    h.close()
  }
})

test('資源が違えば同時に走る', async () => {
  const h = makeHarness()
  try {
    const g = gate()
    const queue = new JobQueue(h.store)
    queue.register('work', g.handler)
    queue.start()

    queue.enqueue({ kind: 'work', target: 'gpu1', resource: 'gpu' })
    queue.enqueue({ kind: 'work', target: 'codex1', resource: 'codex' })

    assert.deepEqual([...g.started].sort(), ['codex1', 'gpu1'])
    g.openAll()
    await queue.drain()
  } finally {
    h.close()
  }
})

test('枠が尽きている間は codex の仕事を止め、GPU の仕事は止めない', async () => {
  const h = makeHarness()
  try {
    const g = gate()
    let blocked = true
    const queue = new JobQueue(h.store, { quota: { blocked: () => blocked, resumeAt: () => null } })
    queue.register('work', g.handler)
    queue.start()

    queue.enqueue({ kind: 'work', target: 'codex1', resource: 'codex' })
    queue.enqueue({ kind: 'work', target: 'gpu1', resource: 'gpu' })

    assert.deepEqual(g.started, ['gpu1'])
    assert.equal(h.store.counts().waitingForQuota, 1)

    blocked = false
    queue.onQuotaChanged()
    assert.deepEqual([...g.started].sort(), ['codex1', 'gpu1'])
    assert.equal(h.store.counts().waitingForQuota, 0)

    g.openAll()
    await queue.drain()
    queue.stop()
  } finally {
    h.close()
  }
})

test('枠の回復待ちは試行回数を数えない', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store, { quota: { blocked: () => true, resumeAt: () => null } })
    queue.register('work', async () => {})
    queue.start()

    const job = queue.enqueue({ kind: 'work', target: 'x', resource: 'codex' })
    const stored = h.store.get(job.id)
    assert.equal(stored?.state, 'waitingForQuota')
    assert.equal(stored?.attempts, 0)
    queue.stop()
  } finally {
    h.close()
  }
})

test('失敗は試行回数を数え、上限で諦める', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store, { retryDelayMs: 0, maxAttempts: 2 })
    queue.register('work', async () => {
      throw new Error('わざと失敗する')
    })
    queue.start()

    const job = queue.enqueue({ kind: 'work', target: 'x', resource: 'gpu' })
    await queue.drain()

    const stored = h.store.get(job.id)
    assert.equal(stored?.state, 'failed')
    assert.equal(stored?.attempts, 2)
    assert.equal(stored?.lastError, 'わざと失敗する')
  } finally {
    h.close()
  }
})

test('扱う処理が無い仕事は失敗として残す', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    queue.start()
    const job = queue.enqueue({ kind: '未登録', target: 'x', resource: 'gpu' })
    assert.equal(h.store.get(job.id)?.state, 'failed')
  } finally {
    h.close()
  }
})

test('再起動をまたいで未完了の仕事が残り、実行中のものは待機へ戻る', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-jobs-'))
  const file = join(root, 'state.sqlite')
  try {
    const first = new StateDb(file)
    const store1 = new JobStore(first.db)
    const g = gate()
    const queue1 = new JobQueue(store1)
    queue1.register('work', g.handler)
    queue1.start()
    queue1.enqueue({ kind: 'work', target: '走り始めた', resource: 'gpu' })
    queue1.enqueue({ kind: 'work', target: '待機中', resource: 'gpu' })
    assert.equal(store1.counts().running, 1)
    assert.equal(store1.counts().pending, 1)
    // 走らせたまま落ちた状況を作る。
    first.close()

    const second = new StateDb(file)
    const store2 = new JobStore(second.db)
    assert.equal(store2.counts().running, 1)

    const g2 = gate()
    const queue2 = new JobQueue(store2)
    queue2.register('work', g2.handler)
    queue2.start()

    assert.equal(store2.counts().running, 1)
    assert.deepEqual(g2.started, ['走り始めた'])
    assert.equal(store2.counts().pending, 1)

    g2.openAll()
    await queue2.drain()
    assert.deepEqual(g2.started, ['走り始めた', '待機中'])
    second.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('終わった古い仕事を捨てられる', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    queue.register('work', async () => {})
    queue.start()
    for (let i = 0; i < 5; i += 1) queue.enqueue({ kind: 'work', target: `t${i}`, resource: 'gpu' })
    await queue.drain()

    assert.equal(h.store.counts().done, 5)
    // 直近 2 件を残し、それより古いものを捨てる。時刻は同じ秒に並ぶので、判定の
    // 起点を少し先に置く。
    assert.equal(h.store.pruneFinished(2, 0, Date.now() + 1000), 3)
    assert.equal(h.store.counts().done, 2)
  } finally {
    h.close()
  }
})

test('新しい仕事は、時間が経っていなければ捨てない', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    queue.register('work', async () => {})
    queue.start()
    for (let i = 0; i < 5; i += 1) queue.enqueue({ kind: 'work', target: `t${i}`, resource: 'gpu' })
    await queue.drain()

    assert.equal(h.store.pruneFinished(2, 60_000), 0, '直近 2 件の外でも、1 分を過ぎていなければ残る')
    assert.equal(h.store.counts().done, 5)
  } finally {
    h.close()
  }
})

test('失敗した古い仕事も捨てる', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store, { maxAttempts: 1 })
    queue.register('work', async () => {
      throw new Error('失敗')
    })
    queue.start()
    for (let i = 0; i < 3; i += 1) queue.enqueue({ kind: 'work', target: `t${i}`, resource: 'gpu' })
    await queue.drain()

    assert.equal(h.store.counts().failed, 3)
    assert.equal(h.store.pruneFinished(1, 0, Date.now() + 1000), 2)
    assert.equal(h.store.counts().failed, 1)
  } finally {
    h.close()
  }
})

test('終わった仕事だけを消せる', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    queue.register('work', async () => {})
    queue.start()
    for (let i = 0; i < 3; i += 1) queue.enqueue({ kind: 'work', target: `t${i}`, resource: 'gpu' })
    await queue.drain()
    // 走らせない仕事を 1 つ足しておく。
    h.store.enqueue({ kind: 'other', target: 'keep', resource: 'gpu', priority: 'background' })

    assert.equal(h.store.clearFinished(), 3)
    assert.equal(h.store.counts().done, 0)
    assert.equal(h.store.counts().pending, 1)
  } finally {
    h.close()
  }
})

test('論文を消すと、その論文のまだ走り出していない仕事が取り消される', () => {
  const h = makeHarness()
  try {
    h.store.enqueue({ kind: 'convert', target: '消す論文', resource: 'gpu', priority: 'foreground' })
    h.store.enqueue({ kind: 'verify', target: '消す論文', resource: 'codex', priority: 'foreground' })
    h.store.enqueue({ kind: 'convert', target: '残す論文', resource: 'gpu', priority: 'foreground' })

    const result = h.store.cancelPending('消す論文')

    assert.deepEqual(result, { cancelled: 2, running: 0 })
    assert.deepEqual(
      h.store.list().map((j) => j.target),
      ['残す論文'],
    )
  } finally {
    h.close()
  }
})

test('実行中の仕事は取り消さずに数だけ返す', () => {
  const h = makeHarness()
  try {
    const running = h.store.enqueue({ kind: 'convert', target: '消す論文', resource: 'gpu', priority: 'foreground' })
    h.store.setState(running.id, 'running')
    h.store.enqueue({ kind: 'verify', target: '消す論文', resource: 'codex', priority: 'foreground' })

    const result = h.store.cancelPending('消す論文')

    assert.deepEqual(result, { cancelled: 1, running: 1 })
    assert.deepEqual(
      h.store.list().map((j) => j.kind),
      ['convert'],
    )
  } finally {
    h.close()
  }
})

test('止めると、走っている仕事に合図が届いて記録ごと消える(#329)', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    let told: AbortSignal | null = null
    queue.register('verify', async (_job, signal) => {
      told = signal
      // 束の切れ目で合図を見る段階と同じように、立ってから抜ける。
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('止めた')
    })
    queue.start()
    queue.enqueue({ kind: 'verify', target: '消す論文', resource: 'codex' })
    await tick()

    const result = await queue.cancel('消す論文')

    assert.equal(result.stopped, 1)
    assert.equal((told as AbortSignal | null)?.aborted, true)
    // 止めた仕事は失敗として残さない。やり直しの対象にも一覧にも出さない。
    assert.deepEqual(h.store.list(), [])
  } finally {
    h.close()
  }
})

test('止めると、待っている仕事も消える(#329)', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store)
    queue.register('verify', async (_job, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    })
    queue.start()
    // Codex の同時実行は 4 本なので、5 本目は走り出さずに待つ(0003)。
    for (let i = 0; i < 5; i += 1) queue.enqueue({ kind: 'verify', target: '消す論文', resource: 'codex' })
    queue.enqueue({ kind: 'verify', target: '残す論文', resource: 'codex' })
    await tick()

    const result = await queue.cancel('消す論文')

    assert.equal(result.cancelled, 1)
    assert.equal(result.stopped, 4)
    assert.deepEqual(
      h.store.list().map((j) => j.target),
      ['残す論文'],
    )
  } finally {
    h.close()
  }
})

test('止めていない仕事の失敗は、今まで通りやり直しに回る(#329)', async () => {
  const h = makeHarness()
  try {
    const queue = new JobQueue(h.store, { retryDelayMs: 1000 })
    queue.register('verify', async () => {
      throw new Error('落ちた')
    })
    queue.start()
    queue.enqueue({ kind: 'verify', target: '論文', resource: 'codex' })
    await tick()

    const job = h.store.list()[0]
    assert.equal(job?.state, 'pending')
    assert.equal(job?.attempts, 1)
    assert.equal(job?.lastError, '落ちた')
  } finally {
    h.close()
  }
})
