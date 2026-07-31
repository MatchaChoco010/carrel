import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitAtReferences } from './references.ts'

test('見出しの前・節・後ろに分ける', () => {
  const split = splitAtReferences('# 1 Introduction\n\n本文。\n\n## References\n\n[1] A. Author, 2020.\n\n## Appendix\n\n付録。')
  assert.ok(split !== null)
  assert.match(split.before, /## References\s*$/)
  assert.equal(split.section, '[1] A. Author, 2020.')
  assert.match(split.after, /^## Appendix/)
})

test('末尾の節では後ろが空になる', () => {
  const split = splitAtReferences('# 本文\n\n## 参考文献\n\n1 件目。')
  assert.equal(split?.section, '1 件目。')
  assert.equal(split?.after, '')
})

test('見出しの書き方が違っても切り出す', () => {
  for (const heading of ['## References', '## REFERENCES', '# Reference', '## 参考文献', '## 6. References', '## Bibliography']) {
    assert.equal(splitAtReferences(`${heading}\n\n1 件目。`)?.section, '1 件目。', heading)
  }
})

test('参考文献の節が無ければ null になる', () => {
  assert.equal(splitAtReferences('# 1 Introduction\n\n本文。'), null)
})
