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
    'analytic-spherical-harmonic-coefficients',
  )
})

test('冠詞と前置詞と接続詞は飛ばす(0023)', () => {
  assert.equal(
    keywordFromTitle('Clustering on the Unit Hypersphere using von Mises-Fisher Distributions'),
    'clustering-unit-hypersphere-mises-fisher',
  )
})

test('飛ばすと 2 語に満たない題は、そのまま使う(0023)', () => {
  assert.equal(keywordFromTitle('Attention Is All You Need'), 'attention-is-all-you-need')
})

test('32 文字に達したら止める(0023)', () => {
  const keyword = keywordFromTitle(
    'Successive Height Preintegration for a Height-Interdependent Path Formulation of Multiple Bounces',
  )
  assert.equal(keyword, 'successive-height-preintegration')
})

test('32 文字を跨ぐ 1 語は、48 文字以内なら入れる(0023)', () => {
  assert.equal(
    keywordFromTitle('Interactive Cloth Rendering of Microcylinder Appearance Model under Environment Lighting'),
    'interactive-cloth-rendering-microcylinder',
  )
})

test('48 文字を超える語は入れない(0023)', () => {
  assert.equal(
    keywordFromTitle('Clustering Unit Hypersphere Hyperparameterization'),
    'clustering-unit-hypersphere',
  )
})

test('語は 5 つまで(0023)', () => {
  const keyword = keywordFromTitle('Fast Deep Wide Neural Nets Beat Old Slow Ones')
  assert.equal(keyword, 'fast-deep-wide-neural-nets')
})

test('ハイフンで繋がれた複合語は割らない(0023)', () => {
  assert.equal(
    keywordFromTitle('Real-Time Neural Materials using Block-Compressed Features'),
    'real-time-neural-materials-block-compressed',
  )
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
  assert.equal(keywordFromTitle(title), 'clustering-unit-hypersphere-mises-fisher')
  assert.equal(keywordFromTitle(title, ['von']), 'clustering-unit-hypersphere-von-mises-fisher')
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

test('著者や年が取れなくても、題から作った語幹は残す(#308)', () => {
  const noAuthor = buildSlug({ authors: [], year: 2020, title: 'NeRF: x', identity: 'x' }, never)
  assert.equal(noAuthor, 'unknown2020-nerf')

  const noYear = buildSlug({ authors: ['Ben Mildenhall'], year: null, title: 'NeRF: x', identity: 'x' }, never)
  assert.equal(noYear, 'mildenhall0000-nerf')

  const neither = buildSlug({ authors: [], year: null, title: 'NeRF: x', identity: 'x' }, never)
  assert.equal(neither, 'unknown0000-nerf')
})

test('本の 1 章で年が読めなくても、何の論文かが残る(#308)', () => {
  // 本番で `unknown0000-d45395cc` になった論文である。
  const slug = buildSlug(
    {
      authors: ['J. P. Collomosse'],
      year: null,
      title: 'Evolutionary search for the artistic rendering of photographs',
      identity: 'x',
    },
    never,
  )
  assert.equal(slug, 'collomosse0000-evolutionary-search-artistic-rendering')
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
  assert.equal(slug, 'banerjee2005-clustering-unit-hypersphere-von-mises-fisher')
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
  assert.equal(slug, 'wang2018-analytic-spherical-harmonic-coefficients')
})

test('語幹が取れないときも一意な slug になる', () => {
  const slug = buildSlug({ authors: ['Ben Mildenhall'], year: 2020, title: '', identity: 'x' }, never)
  assert.match(slug, /^mildenhall2020-[0-9a-f]{8}$/)
})

test('何も読めないときだけ、固有の文字列に落ちる(#308)', () => {
  const slug = buildSlug({ authors: [], year: null, title: '', identity: 'x' }, never)
  assert.match(slug, /^unknown0000-[0-9a-f]{8}$/)
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
