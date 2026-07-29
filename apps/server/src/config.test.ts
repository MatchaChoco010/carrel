import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultConfig, mergeConfig } from './config.ts'

test('空の設定は既定値になる', () => {
  assert.deepEqual(mergeConfig({}), defaultConfig)
  assert.deepEqual(mergeConfig(null), defaultConfig)
  assert.deepEqual(mergeConfig('壊れた値'), defaultConfig)
})

test('書かれたキーだけを既定値の上に重ねる', () => {
  const merged = mergeConfig({ arxiv: { categories: ['cs.GR', 'cs.CV'] } })
  assert.deepEqual(merged.arxiv.categories, ['cs.GR', 'cs.CV'])
  assert.equal(merged.arxiv.fetchIntervalMinutes, defaultConfig.arxiv.fetchIntervalMinutes)
  assert.equal(merged.server.port, defaultConfig.server.port)
})

test('待ち受けるアドレスを設定で変えられる', () => {
  assert.equal(mergeConfig({ server: { host: '127.0.0.1' } }).server.host, '127.0.0.1')
  assert.equal(mergeConfig({}).server.host, '0.0.0.0')
  assert.equal(mergeConfig({ server: { host: '' } }).server.host, defaultConfig.server.host)
})

test('範囲の外れた値は既定値のまま残す', () => {
  assert.equal(mergeConfig({ server: { port: 0 } }).server.port, defaultConfig.server.port)
  assert.equal(mergeConfig({ server: { port: 70000 } }).server.port, defaultConfig.server.port)
  assert.equal(mergeConfig({ server: { port: 'abc' } }).server.port, defaultConfig.server.port)
  assert.equal(
    mergeConfig({ arxiv: { fetchIntervalMinutes: -1 } }).arxiv.fetchIntervalMinutes,
    defaultConfig.arxiv.fetchIntervalMinutes,
  )
})

test('未知のキーは捨てる', () => {
  const merged = mergeConfig({ unknownKey: 'x', dataDir: '/mnt/nas/pct' })
  assert.equal(merged.dataDir, '/mnt/nas/pct')
  assert.equal('unknownKey' in merged, false)
})

test('カテゴリの配列から文字列でない要素を落とす', () => {
  assert.deepEqual(mergeConfig({ arxiv: { categories: ['cs.GR', 42, '', null] } }).arxiv.categories, ['cs.GR'])
})

test('既定値を書き換えない', () => {
  const merged = mergeConfig({ arxiv: { categories: ['cs.CV'] } })
  merged.arxiv.categories.push('cs.LG')
  assert.deepEqual(defaultConfig.arxiv.categories, ['cs.GR'])
})

test('取り込みの段階のモデルと effort を読む', () => {
  const c = mergeConfig({ ingest: { model: 'gpt-5.6-terra', effort: 'high' } })
  assert.equal(c.ingest.model, 'gpt-5.6-terra')
  assert.equal(c.ingest.effort, 'high')
})

test('取り込みの設定が無ければ既定値を使う', () => {
  const c = mergeConfig({})
  assert.equal(c.ingest.model, 'gpt-5.6-sol')
  assert.equal(c.ingest.effort, 'low')
})

test('取り込みの設定が空文字なら既定値を保つ', () => {
  const c = mergeConfig({ ingest: { model: '', effort: '' } })
  assert.equal(c.ingest.model, 'gpt-5.6-sol')
  assert.equal(c.ingest.effort, 'low')
})

test('埋め込みの設定を読む', () => {
  const c = mergeConfig({ embedding: { baseUrl: 'http://x:1', model: 'other', dimensions: 768 } })
  assert.equal(c.embedding.baseUrl, 'http://x:1')
  assert.equal(c.embedding.model, 'other')
  assert.equal(c.embedding.dimensions, 768)
})

test('埋め込みの次元が整数でなければ既定値を保つ', () => {
  const c = mergeConfig({ embedding: { dimensions: 0 } })
  assert.equal(c.embedding.dimensions, 1024)
})
