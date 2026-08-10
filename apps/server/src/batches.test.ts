import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inBatches, Stopped } from './batches.ts'

test('決まった数ずつ走らせ、入力の順で返す', async () => {
  const order: number[] = []
  const result = await inBatches([1, 2, 3, 4, 5], 2, async (n) => {
    order.push(n)
    return n * 2
  })

  assert.deepEqual(result, [2, 4, 6, 8, 10])
  assert.deepEqual(order, [1, 2, 3, 4, 5])
})

test('止められたら、次の束へ進まずに投げる(#329)', async () => {
  const stop = new AbortController()
  const ran: number[] = []

  await assert.rejects(
    inBatches(
      [1, 2, 3, 4],
      2,
      async (n) => {
        ran.push(n)
        // 1 束目の途中で止める。飛んでいる束は最後まで走る。
        stop.abort()
        return n
      },
      stop.signal,
    ),
    Stopped,
  )

  assert.deepEqual(ran, [1, 2])
})

test('止められていなければ、最後まで走る(#329)', async () => {
  const stop = new AbortController()
  const result = await inBatches([1, 2, 3], 2, async (n) => n, stop.signal)
  assert.deepEqual(result, [1, 2, 3])
})
