import assert from 'node:assert/strict'
import test from 'node:test'
import type { Ingest } from './api.ts'
import { clockFor, stageElapsed, totalElapsed } from './ingest-timing.ts'

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
