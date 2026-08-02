import assert from 'node:assert/strict'
import test from 'node:test'
import { familyName, findSamePaper, normalizeTitle, sameFirstAuthor, type Candidate } from './same-paper.ts'

const NERF: Candidate = {
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
  const slug = findSamePaper(papers, {
    title: '別の題',
    authors: [],
    doi: '10.1145/3503250',
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('DOI が無くても、題と筆頭著者が一致すれば同じ論文', () => {
  const slug = findSamePaper([NERF], {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['B. Mildenhall'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('筆頭著者が違えば別の論文', () => {
  const slug = findSamePaper([NERF], {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Someone Else'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, null)
})

test('識別子が食い違う組は、版の違いとして別の論文にする', () => {
  // プレプリントと会議版は題も著者も同じだが、別の論文として扱う(0004)。
  const slug = findSamePaper([NERF], {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Ben Mildenhall'],
    doi: null,
    arxivId: '9999.99999',
  })
  assert.equal(slug, null)
})

test('片方が著者を持たなければ、題の一致で同じ論文とみなす', () => {
  const slug = findSamePaper([{ ...NERF, authors: [] }], {
    title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis',
    authors: ['Ben Mildenhall'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('題が違えば同じ論文にしない', () => {
  const slug = findSamePaper([NERF], {
    title: 'Instant Neural Graphics Primitives',
    authors: ['Thomas Müller'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, null)
})

test('まだ登録まで進んでいない取り込みも、同じ論文として引き当てる(#263)', () => {
  const failed: Candidate = {
    slug: 'olajos2026-clouds',
    title: 'Environmental Volumetric Neural Shading of Clouds for Real-Time Rendering',
    // 記録には著者を持たないので、題と DOI だけで突き合わせる。
    authors: [],
    doi: '10.1145/3820020',
    arxivId: null,
  }
  const byDoi = findSamePaper([failed], {
    title: '読み取りの揺れた題',
    authors: ['Rikard Olajos'],
    doi: '10.1145/3820020',
    arxivId: null,
  })
  assert.equal(byDoi, 'olajos2026-clouds')

  const byTitle = findSamePaper([failed], {
    title: 'Environmental Volumetric Neural Shading of Clouds for Real-Time Rendering',
    authors: ['Rikard Olajos'],
    doi: null,
    arxivId: null,
  })
  assert.equal(byTitle, 'olajos2026-clouds')
})

test('発音記号と ß の違いを越えて、同じ姓と判じる(#282)', () => {
  // 同じ人の名前が、出所によって両方の綴りで出てくる。
  assert.equal(familyName('Vincent Schüßler'), familyName('Vincent Schüssler'))
  assert.equal(familyName('T. Müller'), familyName('Thomas Muller'))
  assert.ok(sameFirstAuthor(['Vincent Schüßler', 'Eric Heitz'], ['Vincent Schüssler']))
})

test('綴りが揺れていても、題が同じなら同じ論文と判じる(#282)', () => {
  const known: Candidate = {
    slug: 'schussler2017-microfacet-normal-mapping',
    title: 'Microfacet-based Normal Mapping for Robust Monte Carlo Path Tracing',
    authors: ['Vincent Schüssler', 'Eric Heitz'],
    doi: '10.1145/3130800.3130806',
    arxivId: null,
  }
  const slug = findSamePaper([known], {
    title: 'Microfacet-based Normal Mapping for Robust Monte Carlo Path Tracing',
    authors: ['Vincent Schüßler', 'Eric Heitz'],
    doi: null,
    arxivId: null,
  })
  assert.equal(slug, 'schussler2017-microfacet-normal-mapping')
})
