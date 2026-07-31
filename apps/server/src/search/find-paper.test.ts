import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findPaper, normalizeTitle, titleIndex } from './find-paper.ts'

const BELCOUR = { slug: 'belcour2018-clipped-spherical-harmonics', title: 'Integrating Clipped Spherical Harmonics Expansions', year: 2018 }

function deps(over: Partial<Parameters<typeof findPaper>[1]> = {}) {
  return { byArxivId: () => null, byDoi: () => null, byTitle: titleIndex([BELCOUR]), ...over }
}

test('題は記号と大文字小文字の違いを落として比べる', () => {
  assert.equal(
    normalizeTitle('Mip-NeRF 360: Unbounded Anti-Aliased Fields'),
    normalizeTitle('mip nerf 360 unbounded antialiased fields'),
  )
})

test('題で引ける。書き方の揺れは落として比べる', () => {
  const found = findPaper({ title: 'integrating clipped spherical-harmonics expansions!' }, deps())
  assert.deepEqual(found, { slug: BELCOUR.slug, title: BELCOUR.title })
})

test('題が同じでも年が食い違えば当てない', () => {
  assert.equal(findPaper({ title: BELCOUR.title, year: 2021 }, deps()), null)
})

test('arXiv の識別子は DOI と題より先に見る', () => {
  const found = findPaper(
    { title: BELCOUR.title, arxivId: 'arXiv:2003.08934v2', doi: '10.1145/3015459' },
    deps({ byArxivId: (id) => (id === '2003.08934' ? 'mildenhall2020-nerf' : null), byDoi: () => 'other2018-paper' }),
  )
  assert.equal(found?.slug, 'mildenhall2020-nerf')
})

test('DOI は題より先に見る。前置きが付いていても読む', () => {
  const found = findPaper(
    { title: BELCOUR.title, doi: 'https://doi.org/10.1145/3015459' },
    deps({ byDoi: (doi) => (doi === '10.1145/3015459' ? 'belcour2018-from-doi' : null) }),
  )
  assert.equal(found?.slug, 'belcour2018-from-doi')
})

test('鍵が無ければ当たらない', () => {
  assert.equal(findPaper({}, deps()), null)
  assert.equal(findPaper({ title: 'A Paper Nobody Has' }, deps()), null)
})
