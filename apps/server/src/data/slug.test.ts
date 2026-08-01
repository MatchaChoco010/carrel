import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSlug, isValidSlug, keywordFromTitle, keywordInTitle, lastNameOf, normalizeName } from './slug.ts'

const never = (): boolean => false

test('姓を ASCII の小文字へ落とす', () => {
  assert.equal(normalizeName('Mildenhall'), 'mildenhall')
  assert.equal(normalizeName('Müller'), 'muller')
  assert.equal(normalizeName('Pérez-González'), 'perezgonzalez')
  assert.equal(normalizeName("O'Brien"), 'obrien')
})

test('著者名の並びに関わらず姓を取り出す', () => {
  assert.equal(lastNameOf('Ben Mildenhall'), 'mildenhall')
  assert.equal(lastNameOf('Mildenhall, Ben'), 'mildenhall')
  assert.equal(lastNameOf('Jonathan T. Barron'), 'barron')
  assert.equal(lastNameOf('   '), '')
})

test('題の語から語幹を作る(0023)', () => {
  assert.equal(keywordFromTitle('3D Gaussian Splatting'), '3d-gaussian-splatting')
  assert.equal(
    keywordFromTitle('Analytic spherical harmonic coefficients for polygonal area lights'),
    'analytic-spherical-harmonic',
  )
})

test('冠詞と前置詞と接続詞は飛ばす(0023)', () => {
  assert.equal(
    keywordFromTitle('Clustering on the Unit Hypersphere using von Mises-Fisher Distributions'),
    'clustering-unit-hypersphere',
  )
})

test('飛ばすと 2 語に満たない題は、そのまま使う(0023)', () => {
  assert.equal(keywordFromTitle('Attention Is All You Need'), 'attention-is-all-you-need')
})

test('5 語と 32 文字を超えない(0023)', () => {
  const keyword = keywordFromTitle(
    'Successive Height Preintegration for a Height-Interdependent Path Formulation of Multiple Bounces',
  )
  assert.equal(keyword, 'successive-height-preintegration')
  assert.ok(keyword.length <= 32)
  assert.ok(keyword.split('-').length <= 5)
})

test('コロンより前が短ければ、そこを略称として使う', () => {
  assert.equal(keywordFromTitle('NeRF: Representing Scenes as Neural Radiance Fields'), 'nerf')
  assert.equal(keywordFromTitle('Mip-NeRF 360: Unbounded Anti-Aliased Neural Radiance Fields'), 'mip-nerf-360')
})

test('コロンより前が長い場合は題の語から取る', () => {
  assert.equal(
    keywordFromTitle('Neural Radiance Fields for Unbounded Scenes: A Study'),
    'neural-radiance-fields-unbounded',
  )
})

test('題に出てこない語は略称として使わない(0023)', () => {
  const title = 'Analytic spherical harmonic coefficients for polygonal area lights'
  assert.equal(keywordInTitle('ash', title), false)
  assert.equal(keywordInTitle('analytic spherical', title), true)
  assert.equal(keywordInTitle('NeRF', 'NeRF: Representing Scenes'), true)
})

test('citekey 風の slug を作る', () => {
  const slug = buildSlug(
    {
      authors: ['Ben Mildenhall', 'Pratul P. Srinivasan'],
      year: 2020,
      title: 'NeRF: Representing Scenes as Neural Radiance Fields',
      keyword: 'NeRF',
      identity: 'arxiv:2003.08934',
    },
    never,
  )
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('衝突したら連番を付ける', () => {
  const taken = new Set(['mildenhall2020-nerf', 'mildenhall2020-nerf-2'])
  const slug = buildSlug(
    { authors: ['Ben Mildenhall'], year: 2020, title: 'NeRF: Representing Scenes', keyword: 'NeRF', identity: 'x' },
    (candidate) => taken.has(candidate),
  )
  assert.equal(slug, 'mildenhall2020-nerf-3')
})

test('著者か年が取れないときはフォールバックする', () => {
  const noAuthor = buildSlug({ authors: [], year: 2020, title: 'NeRF: x', keyword: 'NeRF', identity: 'x' }, never)
  assert.match(noAuthor, /^unknown2020-[0-9a-f]{8}$/)

  const noYear = buildSlug(
    { authors: ['Ben Mildenhall'], year: null, title: 'NeRF: x', keyword: 'NeRF', identity: 'x' },
    never,
  )
  assert.match(noYear, /^unknown0000-[0-9a-f]{8}$/)
})

test('提案された語が題に無ければ、題から作り直す(0023)', () => {
  const slug = buildSlug(
    {
      authors: ['Jiaping Wang'],
      year: 2018,
      title: 'Analytic spherical harmonic coefficients for polygonal area lights',
      keyword: 'ASH',
      identity: 'x',
    },
    never,
  )
  assert.equal(slug, 'wang2018-analytic-spherical-harmonic')
})

test('語幹が取れないときも一意な slug になる', () => {
  const slug = buildSlug({ authors: ['Ben Mildenhall'], year: 2020, title: '', keyword: null, identity: 'x' }, never)
  assert.match(slug, /^mildenhall2020-[0-9a-f]{4}$/)
})

test('同じ入力からは同じ slug が出る', () => {
  const source = {
    authors: ['Ben Mildenhall'],
    year: 2020,
    title: 'NeRF: Representing Scenes',
    keyword: 'NeRF',
    identity: 'arxiv:2003.08934',
  }
  assert.equal(buildSlug(source, never), buildSlug(source, never))
})

test('ディレクトリ名として扱える slug だけを受け付ける', () => {
  assert.equal(isValidSlug('mildenhall2020-nerf'), true)
  assert.equal(isValidSlug('unknown0000-1a2b3c4d'), true)
  assert.equal(isValidSlug(''), false)
  assert.equal(isValidSlug('.git'), false)
  assert.equal(isValidSlug('has space'), false)
  assert.equal(isValidSlug('Upper'), false)
  assert.equal(isValidSlug('-leading'), false)
  assert.equal(isValidSlug('trailing-'), false)
  assert.equal(isValidSlug('../escape'), false)
})
