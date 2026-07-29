import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreImages } from './run.ts'

test('照合が落とした図の参照を戻す', () => {
  const before = '本文\n\n![](assets/page-1-Figure-2.jpeg)\n\n![](assets/page-1-Figure-3.jpeg)'
  const after = restoreImages(before, '本文を直したもの')

  assert.match(after, /!\[\]\(assets\/page-1-Figure-2\.jpeg\)/)
  assert.match(after, /!\[\]\(assets\/page-1-Figure-3\.jpeg\)/)
})

test('照合が残した図の参照は動かさない', () => {
  const before = '本文\n\n![](assets/a.jpeg)'
  const after = restoreImages(before, '直した本文\n\n![](assets/a.jpeg)\n\n続き')

  assert.equal(after, '直した本文\n\n![](assets/a.jpeg)\n\n続き')
})

test('落ちた分だけを戻す', () => {
  const before = '![](assets/a.jpeg)\n\n![](assets/b.jpeg)'
  const after = restoreImages(before, '本文\n\n![](assets/b.jpeg)')

  assert.equal(after, '本文\n\n![](assets/b.jpeg)\n\n![](assets/a.jpeg)')
})

test('図の無いページは素通しする', () => {
  assert.equal(restoreImages('本文だけ', '直した本文  '), '直した本文  ')
})
