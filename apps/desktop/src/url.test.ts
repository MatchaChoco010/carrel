import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appUrl, healthUrl, serverOrigin, SURFACE_MARK } from './url.ts'

test('待ち受けの設定から URL を組み立てる', () => {
  assert.equal(serverOrigin({ host: '127.0.0.1', port: 7817 }), 'http://127.0.0.1:7817')
})

test('全てのアドレスで待ち受けていても、この窓はループバックで繋ぐ', () => {
  for (const host of ['0.0.0.0', '::', '']) {
    assert.equal(serverOrigin({ host, port: 7817 }), 'http://127.0.0.1:7817')
  }
})

test('IPv6 のアドレスは括弧で囲む', () => {
  assert.equal(serverOrigin({ host: 'fd00::1', port: 7817 }), 'http://[fd00::1]:7817')
})

test('設定が欠けていても既定で組み立てる', () => {
  assert.equal(serverOrigin({}), 'http://127.0.0.1:7817')
  assert.equal(serverOrigin({ host: 42, port: 'abc' }), 'http://127.0.0.1:7817')
})

test('UI へ透過モードの印を渡す', () => {
  assert.equal(appUrl('http://127.0.0.1:7817'), 'http://127.0.0.1:7817/?surface=desktop')
  assert.equal(SURFACE_MARK, 'surface=desktop')
})

test('生存の確認は健康の口を叩く', () => {
  assert.equal(healthUrl('http://127.0.0.1:7817'), 'http://127.0.0.1:7817/api/health')
})
