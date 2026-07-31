import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitAtReferences } from './references.ts'

test('見出しまでと、次の見出しから後ろに分ける', () => {
  const split = splitAtReferences('# 1 Introduction\n\n本文。\n\n## References\n\n[1] A. Author, 2020.\n\n## Appendix\n\n付録。')
  assert.ok(split !== null)
  assert.match(split.before, /## References\s*$/)
  assert.equal(split.before.includes('[1] A. Author'), false)
  assert.match(split.after, /^## Appendix/)
})

test('末尾の節では後ろが空になる', () => {
  const split = splitAtReferences('# 本文\n\n## 参考文献\n\n1 件目。')
  assert.ok(split !== null)
  assert.equal(split.after, '')
})

test('見出しの書き方が違っても切り出す', () => {
  for (const heading of ['## References', '## REFERENCES', '# Reference', '## 参考文献', '## 6. References', '## Bibliography']) {
    const split = splitAtReferences(`${heading}\n\n1 件目。`)
    assert.ok(split !== null, heading)
    assert.equal(split.before.includes('1 件目。'), false, heading)
    assert.equal(split.after, '', heading)
  }
})

test('参考文献の節が無ければ null になる', () => {
  assert.equal(splitAtReferences('# 1 Introduction\n\n本文。'), null)
})
