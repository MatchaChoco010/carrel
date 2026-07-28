import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSlug, isValidSlug, lastNameOf, normalizeKeyword, normalizeName } from './slug.ts'

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

test('タイトル由来の語は 3 語までにする', () => {
  assert.equal(normalizeKeyword('NeRF'), 'nerf')
  assert.equal(normalizeKeyword('Neural Radiance Fields for View Synthesis'), 'neural-radiance-fields')
  assert.equal(normalizeKeyword('3D Gaussian Splatting'), '3d-gaussian-splatting')
})

test('コロンより前が短ければ、そこを略称として使う', () => {
  assert.equal(normalizeKeyword('NeRF: Representing Scenes as Neural Radiance Fields'), 'nerf')
  assert.equal(normalizeKeyword('Mip-NeRF 360: Unbounded Anti-Aliased Neural Radiance Fields'), 'mip-nerf-360')
})

test('コロンより前が長い場合はタイトル全体から取る', () => {
  assert.equal(
    normalizeKeyword('Neural Radiance Fields for Unbounded Scenes: A Study'),
    'neural-radiance-fields',
  )
})

test('citekey 風の slug を作る', () => {
  const slug = buildSlug(
    { authors: ['Ben Mildenhall', 'Pratul P. Srinivasan'], year: 2020, keyword: 'NeRF', identity: 'arxiv:2003.08934' },
    never,
  )
  assert.equal(slug, 'mildenhall2020-nerf')
})

test('衝突したら連番を付ける', () => {
  const taken = new Set(['mildenhall2020-nerf', 'mildenhall2020-nerf-2'])
  const slug = buildSlug(
    { authors: ['Ben Mildenhall'], year: 2020, keyword: 'NeRF', identity: 'x' },
    (candidate) => taken.has(candidate),
  )
  assert.equal(slug, 'mildenhall2020-nerf-3')
})

test('著者か年が取れないときはフォールバックする', () => {
  const noAuthor = buildSlug({ authors: [], year: 2020, keyword: 'NeRF', identity: 'x' }, never)
  assert.match(noAuthor, /^unknown2020-[0-9a-f]{8}$/)

  const noYear = buildSlug({ authors: ['Ben Mildenhall'], year: null, keyword: 'NeRF', identity: 'x' }, never)
  assert.match(noYear, /^unknown0000-[0-9a-f]{8}$/)
})

test('語幹が取れないときも一意な slug になる', () => {
  const slug = buildSlug({ authors: ['Ben Mildenhall'], year: 2020, keyword: null, identity: 'x' }, never)
  assert.match(slug, /^mildenhall2020-[0-9a-f]{4}$/)
})

test('同じ入力からは同じ slug が出る', () => {
  const source = { authors: ['Ben Mildenhall'], year: 2020, keyword: 'NeRF', identity: 'arxiv:2003.08934' }
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
