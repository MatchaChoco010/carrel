import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StateDb } from '../db/state-db.ts'
import { InstructionStore } from './instruction-store.ts'

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'carrel-instructions-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  return {
    store: new InstructionStore(state.db),
    close: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('覚えていないスレッドは null を返す', () => {
  const h = harness()
  try {
    assert.equal(h.store.inForce('th_1'), null)
  } finally {
    h.close()
  }
})

test('覚えた指示を返し、上書きできる', () => {
  const h = harness()
  try {
    h.store.remember('th_1', '常体で答える。')
    assert.equal(h.store.inForce('th_1'), '常体で答える。')

    h.store.remember('th_1', '英語で答える。')
    assert.equal(h.store.inForce('th_1'), '英語で答える。')
  } finally {
    h.close()
  }
})

test('空の指示も覚える。指示を消したことと、覚えていないことは違う', () => {
  const h = harness()
  try {
    h.store.remember('th_1', '')
    assert.equal(h.store.inForce('th_1'), '')

    h.store.forget('th_1')
    assert.equal(h.store.inForce('th_1'), null)
  } finally {
    h.close()
  }
})

test('分岐では効いている指示を写す', () => {
  const h = harness()
  try {
    h.store.remember('th_1', '常体で答える。')
    h.store.copy('th_1', 'th_2')

    assert.equal(h.store.inForce('th_2'), '常体で答える。')
    assert.equal(h.store.inForce('th_1'), '常体で答える。', '元は残る')

    h.store.copy('th_unknown', 'th_3')
    assert.equal(h.store.inForce('th_3'), null, '覚えの無いスレッドからは写さない')
  } finally {
    h.close()
  }
})
