import assert from 'node:assert/strict'
import test from 'node:test'
import type { IndexDb } from '../db/index-db.ts'
import { familyName, findSamePaper, normalizeTitle, sameFirstAuthor } from './same-paper.ts'

type Known = { slug: string; title: string; doi: string | null; arxivId: string | null; authors: string[] }

/** 索引の代役。突き合わせに使う口だけを持つ。 */
function index(papers: Known[]): IndexDb {
  return {
    findByDoi: (doi: string) => papers.find((p) => p.doi === doi)?.slug ?? null,
    identities: () => papers,
  } as unknown as IndexDb
}

const NERF: Known = {
  slug: 'mildenhall2020-nerf',
  title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
  doi: null,
  arxivId: '2003.08934',
  authors: ['Ben Mildenhall', 'Pratul P. Srinivasan'],
}

test('題を均して突き合わせる', () => {
  assert.equal(normalizeTitle('NeRF: Representing Scenes'), normalizeTitle('nerf  representing   scenes'))
})

test('姓だけを見るので、名の書き方が違っても同じ著者と分かる', () => {
  assert.equal(familyName('T. Müller'), familyName('Thomas Müller'))
  assert.ok(sameFirstAuthor(['B. Mildenhall'], ['Ben Mildenhall', 'Pratul P. Srinivasan']))
})

test('DOI が一致すれば同じ論文', () => {
  const papers = [{ ...NERF, doi: '10.1145/3503250', arxivId: null }]
  const slug = findSamePaper(index(papers), {
    title: '別の題',
    authors: [],
    doi: '10.1145/3503250',
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('DOI が無くても、題と筆頭著者が一致すれば同じ論文', () => {
  const slug = findSamePaper(index([NERF]), {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['B. Mildenhall'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('筆頭著者が違えば別の論文', () => {
  const slug = findSamePaper(index([NERF]), {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Someone Else'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, null)
})

test('識別子が食い違う組は、版の違いとして別の論文にする', () => {
  // プレプリントと会議版は題も著者も同じだが、別の論文として扱う(0004)。
  const slug = findSamePaper(index([NERF]), {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Ben Mildenhall'],
    doi: null,
    arxivId: '9999.99999',
  })
  assert.equal(slug, null)
})

test('片方が著者を持たなければ、題の一致で同じ論文とみなす', () => {
  const slug = findSamePaper(index([{ ...NERF, authors: [] }]), {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Ben Mildenhall'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('題が違えば同じ論文にしない', () => {
  const slug = findSamePaper(index([NERF]), {
    title: 'Instant Neural Graphics Primitives',
    authors: ['Thomas Müller'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, null)
})
