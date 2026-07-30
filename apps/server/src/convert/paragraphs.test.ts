import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinSplitParagraphs } from './paragraphs.ts'

const join = (...blocks: string[]): string => blocks.join('\n\n')

test('文の途中で割れた段落を繋ぐ', () => {
  const result = joinSplitParagraphs(
    join('our method constructs an explicit mesh envelope which spatially', 'bounds a neural volumetric representation.'),
  )

  assert.equal(
    result.markdown,
    'our method constructs an explicit mesh envelope which spatially bounds a neural volumetric representation.',
  )
  assert.equal(result.joined, 1)
})

test('行末のハイフンで割れた語は、ハイフンを落として繋ぐ', () => {
  const result = joinSplitParagraphs(join('in the geophysics and computa-', 'tional physics community.'))

  assert.equal(result.markdown, 'in the geophysics and computational physics community.')
})

test('大文字で続く語もハイフンなら繋ぐ', () => {
  const result = joinSplitParagraphs(join('recent work [Fridovich-', 'Keil and Yu et al. 2022].'))

  assert.equal(result.markdown, 'recent work [Fridovich-Keil and Yu et al. 2022].')
})

test('文が終わっている段落は繋がない', () => {
  const text = join('This is one sentence.', 'and this looks like a continuation but is not.')

  assert.equal(joinSplitParagraphs(text).markdown, text)
})

test('大文字で始まる段落は繋がない', () => {
  const text = join('ZIAN WANG, NVIDIA, Canada', 'TIANCHANG SHEN, NVIDIA, Canada')

  assert.equal(joinSplitParagraphs(text).markdown, text)
})

test('見出し・図・表・数式・箇条書きは繋がない', () => {
  for (const other of [
    '# 1 Introduction',
    '![](assets/page-0-Picture-1.jpeg)',
    '| a | b |',
    '$$\n\\alpha\n$$',
    '- item',
    '<figure>',
    '[^1]: note',
  ]) {
    const before = join('ends without punctuation', other)
    assert.equal(joinSplitParagraphs(before).markdown, before, `前が地の文で次が ${other.slice(0, 12)}`)

    const after = join(other, 'continues in lower case')
    assert.equal(joinSplitParagraphs(after).markdown, after, `前が ${other.slice(0, 12)}`)
  }
})

test('数式番号は直前の数式に繋げない', () => {
  const text = join('$$\n\\int f(x)\\,dx\n$$', '(1)')

  assert.equal(joinSplitParagraphs(text).markdown, text)
})

test('括弧で始まる続きは繋ぐ', () => {
  const result = joinSplitParagraphs(join('as shown in the evaluation', '(Figure 3, right):'))

  assert.equal(result.markdown, 'as shown in the evaluation (Figure 3, right):')
})

test('3 つ以上に割れていても 1 つにまとめる', () => {
  const result = joinSplitParagraphs(join('one part continues', 'into a second part and', 'then a third part.'))

  assert.equal(result.markdown, 'one part continues into a second part and then a third part.')
  assert.equal(result.joined, 2)
})

test('数式で終わる段落も続きなら繋ぐ', () => {
  const result = joinSplitParagraphs(join('is almost equal to that for $16^3$', 'uniform grid where all points.'))

  assert.equal(result.markdown, 'is almost equal to that for $16^3$ uniform grid where all points.')
})

test('繋ぐところが無ければ本文は変わらない', () => {
  const text = join('# 1 Introduction', 'A complete sentence.', 'Another complete sentence.')
  const result = joinSplitParagraphs(text)

  assert.equal(result.markdown, text)
  assert.equal(result.joined, 0)
})
