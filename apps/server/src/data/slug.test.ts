import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSlug, isValidSlug, keywordFromTitle, lastNameOf, normalizeName, wordsInTitle } from './slug.ts'

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

test('名指しされた語は、題に出てくるものだけを残す(0023)', () => {
  const title = 'Clustering on the Unit Hypersphere using von Mises-Fisher Distributions'
  assert.deepEqual(wordsInTitle(['von', 'de'], title), ['von'])
})

test('名指しされた語は落とさずに拾う(0023)', () => {
  const title = 'Clustering on the Unit Hypersphere using von Mises-Fisher Distributions'
  assert.equal(keywordFromTitle(title), 'clustering-unit-hypersphere')
  assert.equal(keywordFromTitle(title, ['von']), 'clustering-unit-hypersphere-von')
})

test('citekey 風の slug を作る', () => {
  const slug = buildSlug(
    {
      authors: ['Ben Mildenhall', 'Pratul P. Srinivasan'],
      year: 2020,
      title: 'NeRF: Representing Scenes as Neural Radiance Fields',
      identity: 'arxiv:2003.08934',
    },
    never,
  )
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('衝突したら連番を付ける', () => {
  const taken = new Set(['mildenhall2020-nerf', 'mildenhall2020-nerf-2'])
  const slug = buildSlug(
    { authors: ['Ben Mildenhall'], year: 2020, title: 'NeRF: Representing Scenes', identity: 'x' },
    (candidate) => taken.has(candidate),
  )
  assert.equal(slug, 'mildenhall2020-nerf-3')
})

test('著者か年が取れないときはフォールバックする', () => {
  const noAuthor = buildSlug({ authors: [], year: 2020, title: 'NeRF: x', identity: 'x' }, never)
  assert.match(noAuthor, /^unknown2020-[0-9a-f]{8}$/)

  const noYear = buildSlug({ authors: ['Ben Mildenhall'], year: null, title: 'NeRF: x', identity: 'x' }, never)
  assert.match(noYear, /^unknown0000-[0-9a-f]{8}$/)
})

test('名指しされた語を含めて、題の先頭から拾う(0023)', () => {
  const slug = buildSlug(
    {
      authors: ['Arindam Banerjee'],
      year: 2005,
      title: 'Clustering on the Unit Hypersphere using von Mises-Fisher Distributions',
      keepWords: ['von'],
      identity: 'x',
    },
    never,
  )
  assert.equal(slug, 'banerjee2005-clustering-unit-hypersphere-von')
})

test('題に出てこない語は名指しされても使えない(0023)', () => {
  const slug = buildSlug(
    {
      authors: ['Jiaping Wang'],
      year: 2018,
      title: 'Analytic spherical harmonic coefficients for polygonal area lights',
      keepWords: ['ash'],
      identity: 'x',
    },
    never,
  )
  assert.equal(slug, 'wang2018-analytic-spherical-harmonic')
})

test('語幹が取れないときも一意な slug になる', () => {
  const slug = buildSlug({ authors: ['Ben Mildenhall'], year: 2020, title: '', identity: 'x' }, never)
  assert.match(slug, /^mildenhall2020-[0-9a-f]{4}$/)
})

test('同じ入力からは同じ slug が出る', () => {
  const source = {
    authors: ['Ben Mildenhall'],
    year: 2020,
    title: 'NeRF: Representing Scenes',
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
