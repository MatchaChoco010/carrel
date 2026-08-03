import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Job } from '../jobs/types.ts'
import { isImporting, resolvingArxivIds } from './importing.ts'

function job(kind: string, target: string): Job {
  return {
    id: 1,
    kind,
    target,
    resource: 'codex',
    priority: 'foreground',
    state: 'pending',
    attempts: 0,
    availableAt: 0,
    createdAt: 0,
    updatedAt: 0,
    payload: null,
    lastError: null,
  }
}

test('解決を待っている arXiv の識別子を拾う(#295)', () => {
  const ids = resolvingArxivIds([
    job('resolve', 'https://arxiv.org/abs/2003.08934'),
    job('resolve', 'https://arxiv.org/pdf/2306.14442v2'),
    job('resolve', 'Neural Radiance Fields'),
    job('convert', 'https://arxiv.org/abs/1706.03762'),
  ])
  assert.deepEqual([...ids].sort(), ['2003.08934', '2306.14442'])
})

test('記録が実行中なら取り込み中(#295)', () => {
  assert.equal(isImporting('2003.08934', { status: 'inProgress' }, new Set()), true)
})

test('記録が終わっていれば取り込み中ではない(#295)', () => {
  assert.equal(isImporting('2003.08934', { status: 'done' }, new Set()), false)
})

test('失敗した記録は取り込み中ではない(#295)', () => {
  // 仕事の欄からやり直せるが、フィードからも押し直せるほうが手数が少ない。
  assert.equal(isImporting('2003.08934', { status: 'failed' }, new Set()), false)
})

test('記録になる前でも、解決を待っていれば取り込み中(#295)', () => {
  assert.equal(isImporting('2003.08934', null, new Set(['2003.08934'])), true)
})

test('何も積んでいなければ取り込み中ではない(#295)', () => {
  assert.equal(isImporting('2003.08934', null, new Set(['2306.14442'])), false)
})
