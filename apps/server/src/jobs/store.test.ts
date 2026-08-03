import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StateDb } from '../db/state-db.ts'
import { JobStore } from './store.ts'

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), 'pct-job-store-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  return {
    store: new JobStore(state.db),
    close: () => {
      state.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('順序キーの小さい仕事から取り出す(0026)', () => {
  const h = makeHarness()
  try {
    // 後から積んだが、先に受け付けた取り込みの段階である。
    h.store.enqueue({ kind: 'resolve', target: '5 本目の解決', resource: 'codex', priority: 'foreground', orderKey: 500 })
    h.store.enqueue({ kind: 'verify', target: '1 本目の照合', resource: 'codex', priority: 'foreground', orderKey: 100 })

    assert.equal(h.store.nextRunnable('codex')?.target, '1 本目の照合')
  } finally {
    h.close()
  }
})

test('順序キーより優先度が先に効く(0026)', () => {
  const h = makeHarness()
  try {
    h.store.enqueue({ kind: 'feedTranslate', target: '和訳', resource: 'codex', priority: 'background', orderKey: 1 })
    h.store.enqueue({ kind: 'verify', target: '照合', resource: 'codex', priority: 'foreground', orderKey: 900 })

    assert.equal(h.store.nextRunnable('codex')?.target, '照合')
  } finally {
    h.close()
  }
})

test('順序キーが同じなら積んだ順に流す(0026)', () => {
  const h = makeHarness()
  try {
    h.store.enqueue({ kind: 'verify', target: '先', resource: 'codex', priority: 'foreground', orderKey: 100 })
    h.store.enqueue({ kind: 'verify', target: '後', resource: 'codex', priority: 'foreground', orderKey: 100 })

    assert.equal(h.store.nextRunnable('codex')?.target, '先')
  } finally {
    h.close()
  }
})

test('順序キーを渡さなければ積まれた時刻になる(0026)', () => {
  const h = makeHarness()
  try {
    const job = h.store.enqueue({ kind: 'feedFetch', target: 'フィード', resource: 'network' })
    assert.equal(job.orderKey, job.createdAt)
  } finally {
    h.close()
  }
})
