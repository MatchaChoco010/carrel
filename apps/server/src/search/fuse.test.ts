import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuseByRank } from './fuse.ts'

test('両方の経路で上位のものが最上位に来る', () => {
  const text = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const vector = [{ id: 3 }, { id: 1 }, { id: 4 }]
  assert.equal(fuseByRank([text, vector])[0]?.id, 1)
})

test('片方の経路にしか現れないものも拾う', () => {
  const fused = fuseByRank([[{ id: 1 }], [{ id: 2 }]])
  assert.deepEqual(
    fused.map((f) => f.id).sort(),
    [1, 2],
  )
})

test('順位が同じなら識別子の順で安定する', () => {
  const fused = fuseByRank([[{ id: 5 }, { id: 3 }], []])
  assert.deepEqual(
    fused.map((f) => f.id),
    [5, 3],
  )
})

test('片方が空でも動く', () => {
  assert.deepEqual(
    fuseByRank([[{ id: 7 }], []]).map((f) => f.id),
    [7],
  )
})

test('どちらも空なら結果も空', () => {
  assert.deepEqual(fuseByRank([[], []]), [])
})

test('上位のほうが高い点になる', () => {
  const fused = fuseByRank([[{ id: 1 }, { id: 2 }]])
  assert.ok((fused[0]?.score ?? 0) > (fused[1]?.score ?? 0))
})

test('両方に出るものは片方だけのものより上に来る', () => {
  // 片方で 1 位のものより、両方で 2 位のもののほうが上に来る場合がある。
  const fused = fuseByRank([
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 2 }],
  ])
  assert.equal(fused[0]?.id, 2)
})
