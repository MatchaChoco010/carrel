import assert from 'node:assert/strict'
import test from 'node:test'
import type { PaperIndexEntry } from './api.ts'
import { authorLine, mentionsOf, prefixOf } from './paper-mention.ts'

function entry(slug: string, over: Partial<PaperIndexEntry> = {}): PaperIndexEntry {
  return {
    slug,
    title: 'A Paper',
    authors: ['Jiaping Wang', 'Peiran Ren'],
    year: 2026,
    addedAt: '2026-07-30T10:00:00+09:00',
    ...over,
  }
}

test('slug の先頭から姓と年を読む', () => {
  assert.deepEqual(prefixOf('wang2026-himat'), { name: 'wang', year: '2026' })
  assert.deepEqual(prefixOf('jimenezayguade2026-deformable-triangle'), { name: 'jimenezayguade', year: '2026' })
})

test('著者と年が取れなかった slug は読まない', () => {
  assert.equal(prefixOf('unknown0000-ab12cd34'), null)
  assert.equal(prefixOf('unknown2020-ab12cd34'), null)
})

test('姓と年の形になっていない slug は読まない', () => {
  assert.equal(prefixOf('mip-nerf-360'), null)
  assert.equal(prefixOf('wang-himat'), null)
})

test('重ならなければ字は付かない', () => {
  const mentions = mentionsOf([entry('zhang2026-successive-height-preintegration')])
  assert.equal(mentions.get('zhang2026-successive-height-preintegration')?.name, 'Zhang 2026')
})

test('同じ姓と年が重なったら字を足す', () => {
  const mentions = mentionsOf([entry('wang2026-himat'), entry('wang2026-restir-g-pt')])
  assert.equal(mentions.get('wang2026-himat')?.name, 'Wang 2026a')
  assert.equal(mentions.get('wang2026-restir-g-pt')?.name, 'Wang 2026b')
})

test('字は索引の並び(取り込んだ順)で振る', () => {
  const later = entry('wang2026-aaa', { addedAt: '2026-08-01T00:00:00+09:00' })
  const earlier = entry('wang2026-zzz', { addedAt: '2026-07-01T00:00:00+09:00' })
  // 索引の口が返す順をそのまま渡す。綴り順ではないので `zzz` に `a` が付く。
  const mentions = mentionsOf([earlier, later])
  assert.equal(mentions.get('wang2026-zzz')?.name, 'Wang 2026a')
  assert.equal(mentions.get('wang2026-aaa')?.name, 'Wang 2026b')
})

test('姓か年が違えば別の組として数える', () => {
  const mentions = mentionsOf([
    entry('wang2026-himat'),
    entry('wang2018-analytic', { year: 2018 }),
    entry('zhang2026-x'),
  ])
  assert.equal(mentions.get('wang2026-himat')?.name, 'Wang 2026')
  assert.equal(mentions.get('wang2018-analytic')?.name, 'Wang 2018')
  assert.equal(mentions.get('zhang2026-x')?.name, 'Zhang 2026')
})

test('26 本を超えたら二文字の字になる', () => {
  const many = Array.from({ length: 27 }, (_, i) => entry(`wang2026-p${i}`))
  const mentions = mentionsOf(many)
  assert.equal(mentions.get('wang2026-p25')?.name, 'Wang 2026z')
  assert.equal(mentions.get('wang2026-p26')?.name, 'Wang 2026aa')
})

test('短縮できない slug は対応表に入らない', () => {
  const mentions = mentionsOf([entry('unknown0000-ab12cd34')])
  assert.equal(mentions.has('unknown0000-ab12cd34'), false)
})

test('著者の行は筆頭著者と年を出す', () => {
  const mentions = mentionsOf([entry('wang2026-himat')])
  assert.equal(authorLine(mentions.get('wang2026-himat') as never), 'Jiaping Wang ほか, 2026')
})

test('著者が 1 人なら「ほか」を付けない', () => {
  const mentions = mentionsOf([entry('wang2026-himat', { authors: ['Jiaping Wang'] })])
  assert.equal(authorLine(mentions.get('wang2026-himat') as never), 'Jiaping Wang, 2026')
})

test('著者も年も無いときは、そのまま書く', () => {
  const mentions = mentionsOf([entry('wang2026-himat', { authors: [], year: null })])
  assert.equal(authorLine(mentions.get('wang2026-himat') as never), '著者不明')
})
