import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VerifyChange } from './prompt.ts'
import { buildReport, type PageReport } from './report.ts'

function change(over: Partial<VerifyChange> = {}): VerifyChange {
  return {
    kind: 'structure',
    source: 'pageImage',
    before: '前',
    after: '後',
    reason: '紙面では別の段だった',
    ...over,
  }
}

function report(over: Partial<PageReport> & { page: number }): PageReport {
  return { changes: [], remaining: null, transcribed: false, ...over }
}

test('ページごとの変更点と理由を読める', () => {
  const md = buildReport([report({ page: 3, changes: [change()], remaining: null })])
  assert.match(md, /## 4 ページ目/)
  assert.match(md, /構造/)
  assert.match(md, /ページ画像/)
  assert.match(md, /紙面では別の段だった/)
})

test('文字を直したときは採った側が文字層と分かる', () => {
  const md = buildReport([
    report({
      page: 0,
      changes: [change({ kind: 'characters', source: 'textLayer', before: 'ualit', after: 'quality' })],
      remaining: null,
    }),
  ])
  assert.match(md, /文字 \| 文字層/)
  assert.match(md, /quality/)
})

test('決めがたかった箇所も残す', () => {
  const md = buildReport([report({ page: 0, changes: [change({ kind: 'undecided', source: 'none' })], remaining: null })])
  assert.match(md, /未決/)
  assert.match(md, /変更なし/)
})

test('照合の後にも残った文字の欠落を書く', () => {
  const md = buildReport([
    report({
      page: 12,
      changes: [],
      remaining: { lost: 2, total: 40, replacements: 0, samples: ['M', 'S'] },
    }),
  ])
  assert.match(md, /照合の後も 2\/40 文字が文字層と一致しない/)
  assert.match(md, /M S/)
})

test('変更も欠落も無いページは載せない', () => {
  const md = buildReport([
    report({ page: 0, changes: [], remaining: null }),
    report({ page: 1, changes: [change()], remaining: null }),
  ])
  assert.doesNotMatch(md, /## 1 ページ目/)
  assert.match(md, /## 2 ページ目/)
})

test('表を壊す文字を含む変更点でも表の形を保つ', () => {
  const md = buildReport([
    report({ page: 0, changes: [change({ before: 'a | b', after: '複数\n行' })], remaining: null }),
  ])
  for (const line of md.split('\n').filter((l) => l.startsWith('| 構造'))) {
    assert.equal(line.split(/(?<!\\)\|/).length - 2, 5)
  }
})

test('全体の件数を冒頭に書く', () => {
  const md = buildReport([
    report({ page: 0, changes: [change(), change()], remaining: null }),
    report({ page: 1, changes: [], remaining: null }),
  ])
  assert.match(md, /2 ページを突き合わせ、1 ページで 2 箇所を変更した/)
})

test('書き起こしたページを記録に残す', () => {
  const md = buildReport([
    report({ page: 0, transcribed: true }),
    report({ page: 1, transcribed: true }),
    report({ page: 2, changes: [change()] }),
  ])

  assert.match(md, /## 書き起こしたページ/)
  assert.match(md, /1, 2/)
  assert.match(md, /読み違いが残っていても検出できない/)
})
