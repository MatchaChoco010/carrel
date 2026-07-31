import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Reference } from '../data/references.ts'
import { matchReferences, normalizeTitle } from './match.ts'

const NONE = { byArxivId: () => null, byDoi: () => null, titles: [] }

function reference(over: Partial<Reference> = {}): Reference {
  return {
    text: 'Laurent Belcour, et al. 2018. Integrating Clipped Spherical Harmonics Expansions.',
    title: 'Integrating Clipped Spherical Harmonics Expansions',
    authors: ['Laurent Belcour'],
    year: 2018,
    arxivId: null,
    doi: null,
    url: null,
    kind: 'paper',
    ...over,
  }
}

test('題は記号と大文字小文字の違いを落として比べる', () => {
  assert.equal(normalizeTitle('Mip-NeRF 360: Unbounded Anti-Aliased Fields'), normalizeTitle('mip nerf 360 unbounded antialiased fields'))
})

test('arXiv の識別子で当たる', () => {
  const matched = matchReferences([reference({ arxivId: 'arXiv:2003.08934v2' })], {
    ...NONE,
    byArxivId: (id) => (id === '2003.08934' ? 'mildenhall2020-nerf' : null),
  })
  assert.deepEqual(matched, ['mildenhall2020-nerf'])
})

test('DOI で当たる。前置きが付いていても読む', () => {
  const matched = matchReferences([reference({ doi: 'https://doi.org/10.1145/3015459' })], {
    ...NONE,
    byDoi: (doi) => (doi === '10.1145/3015459' ? 'belcour2018-clipped-spherical-harmonics' : null),
  })
  assert.deepEqual(matched, ['belcour2018-clipped-spherical-harmonics'])
})

test('題で当たる。書き方の揺れは落として比べる', () => {
  const matched = matchReferences([reference({ title: 'integrating clipped spherical-harmonics expansions!' })], {
    ...NONE,
    titles: [
      { slug: 'belcour2018-clipped-spherical-harmonics', title: 'Integrating Clipped Spherical Harmonics Expansions', year: 2018 },
    ],
  })
  assert.deepEqual(matched, ['belcour2018-clipped-spherical-harmonics'])
})

test('題が同じでも年が食い違えば当てない', () => {
  const matched = matchReferences([reference({ year: 2018 })], {
    ...NONE,
    titles: [{ slug: 'belcour2021-revised', title: 'Integrating Clipped Spherical Harmonics Expansions', year: 2021 }],
  })
  assert.deepEqual(matched, [null])
})

test('鍵が無ければ当たらない', () => {
  assert.deepEqual(matchReferences([reference()], NONE), [null])
})

test('arXiv の識別子は DOI と題より先に見る', () => {
  const matched = matchReferences([reference({ arxivId: '2003.08934', doi: '10.1145/3015459' })], {
    byArxivId: () => 'mildenhall2020-nerf',
    byDoi: () => 'belcour2018-clipped-spherical-harmonics',
    titles: [{ slug: 'other2018-paper', title: 'Integrating Clipped Spherical Harmonics Expansions', year: 2018 }],
  })
  assert.deepEqual(matched, ['mildenhall2020-nerf'])
})
