import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { IndexDb } from '../db/index-db.ts'
import { cosine, fromBlob, toBlob } from './embed.ts'
import { ChunkStore } from './store.ts'

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'carrel-store-'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  return { index, chunks: new ChunkStore(index.db), close: () => (index.close(), rmSync(root, { recursive: true, force: true })) }
}

test('ベクトルを往復させても値が保たれる', () => {
  const v = Float32Array.from([0.5, -0.25, 1])
  assert.deepEqual([...fromBlob(toBlob(v))], [...v])
})

test('同じ向きのベクトルは近い', () => {
  const a = Float32Array.from([1, 0])
  assert.ok(cosine(a, Float32Array.from([2, 0])) > 0.99)
  assert.ok(Math.abs(cosine(a, Float32Array.from([0, 1]))) < 0.01)
})

test('長さがゼロのベクトルは 0 を返す', () => {
  assert.equal(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1])), 0)
})

test('埋め込みのモデルが違えば作り直しが要ると判定する', () => {
  const h = harness()
  try {
    h.chunks.setModel({ model: 'bge-m3', dimensions: 1024 })
    assert.equal(h.chunks.needsRebuild({ model: 'bge-m3', dimensions: 1024 }), false)
    assert.equal(h.chunks.needsRebuild({ model: 'other', dimensions: 1024 }), true)
    assert.equal(h.chunks.needsRebuild({ model: 'bge-m3', dimensions: 768 }), true)
  } finally {
    h.close()
  }
})

test('記録が無くチャンクも無ければ作り直しは要らない', () => {
  const h = harness()
  try {
    assert.equal(h.chunks.needsRebuild({ model: 'bge-m3', dimensions: 1024 }), false)
  } finally {
    h.close()
  }
})
