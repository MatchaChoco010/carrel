import assert from 'node:assert/strict'
import { test } from 'node:test'
import { referencesSection } from './section.ts'

test('見出しから次の見出しまでを取り出す', () => {
  const markdown = [
    '# 1 Introduction',
    '',
    '本文。',
    '',
    '## References',
    '',
    '[1] A. Author, "A Paper," in Proc. X, 2020.',
    '',
    '## Appendix',
    '',
    '付録。',
  ].join('\n')

  assert.equal(referencesSection(markdown), '[1] A. Author, "A Paper," in Proc. X, 2020.')
})

test('末尾の節も取り出す', () => {
  assert.equal(referencesSection('# 本文\n\n## Bibliography\n\n1 件目。'), '1 件目。')
})

test('見出しの書き方が違っても拾う', () => {
  for (const heading of ['## References', '## REFERENCES', '# Reference', '## 参考文献', '## 6. References']) {
    assert.equal(referencesSection(`${heading}\n\n1 件目。`), '1 件目。', heading)
  }
})

test('参考文献の節が無ければ null になる', () => {
  assert.equal(referencesSection('# 1 Introduction\n\n本文。'), null)
})

test('見出しだけで中身が無ければ null になる', () => {
  assert.equal(referencesSection('## References\n\n## Appendix\n\n付録。'), null)
})
