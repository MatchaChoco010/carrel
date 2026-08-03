import assert from 'node:assert/strict'
import test from 'node:test'
import type { Ingest } from './api.ts'
import { clockFor, stageElapsed, stageState, totalElapsed } from './ingest-timing.ts'

const NOW = 1_000_000

function ingest(over: Partial<Ingest>): Ingest {
  return {
    slug: 'a2020-x',
    sourceUrl: 'u',
    stage: 'fetch',
    status: 'inProgress',
    title: null,
    startedAt: 0,
    updatedAt: 500,
    lastError: null,
    stages: [],
    ...over,
  }
}

test('走っている間は、いまの時刻で数える', () => {
  assert.equal(clockFor(ingest({ status: 'inProgress' }), NOW), NOW)
})

test('失敗した取り込みは、記録の最後の時刻で止まる(#280)', () => {
  assert.equal(clockFor(ingest({ status: 'failed', updatedAt: 500 }), NOW), 500)
})

test('終わった取り込みも止まる(#280)', () => {
  assert.equal(clockFor(ingest({ status: 'done', updatedAt: 700 }), NOW), 700)
})

test('終わった段階は、その所要時間のまま', () => {
  assert.equal(stageElapsed({ startedAt: 100, finishedAt: 400 }, NOW), 300)
})

test('開いたままの段階は、渡した時刻までで数える', () => {
  assert.equal(stageElapsed({ startedAt: 100, finishedAt: null }, 450), 350)
})

test('始まりより前の時刻を渡されても負にしない', () => {
  assert.equal(stageElapsed({ startedAt: 800, finishedAt: null }, 500), 0)
})

test('開いたままの段階を持つ失敗は、合計も増えない(#280)', () => {
  const failed = ingest({
    status: 'failed',
    updatedAt: 500,
    stages: [
      { stage: 'resolve', startedAt: 0, finishedAt: 200 },
      // 閉じられないまま残った段階。時計が動くと、ここが伸び続けていた。
      { stage: 'fetch', startedAt: 200, finishedAt: null },
    ],
  })
  assert.equal(totalElapsed(failed, NOW), 500)
  // いまの時刻がどれだけ進んでも変わらない。
  assert.equal(totalElapsed(failed, NOW + 60_000), 500)
})

test('走っている取り込みの合計は、いまの時刻まで伸びる', () => {
  const running = ingest({
    status: 'inProgress',
    stages: [{ stage: 'resolve', startedAt: 0, finishedAt: null }],
  })
  assert.equal(totalElapsed(running, 900), 900)
})

test('段階の状態は 3 つの時刻だけで決まる(0026)', () => {
  assert.equal(stageState({ startedAt: null, finishedAt: null }), 'queued')
  assert.equal(stageState({ startedAt: 100, finishedAt: null }), 'running')
  assert.equal(stageState({ startedAt: 100, finishedAt: 200 }), 'done')
})

test('待っている段階に所要時間は無い(0026)', () => {
  assert.equal(stageElapsed({ startedAt: null, finishedAt: null }, 9000), 0)
})

test('取り込みの合計に待ち時間を足さない(0026)', () => {
  const ingest = {
    status: 'inProgress' as const,
    updatedAt: 0,
    stages: [
      // 走った 2 秒だけを数える。積んでから走り出すまでの 10 秒は入れない。
      { startedAt: 11_000, finishedAt: 13_000 },
      { startedAt: null, finishedAt: null },
    ],
  }
  assert.equal(totalElapsed(ingest, 30_000), 2_000)
})
