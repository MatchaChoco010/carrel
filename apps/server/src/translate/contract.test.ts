import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkContract, describeBreaches } from './contract.ts'

test('本文だけを訳した訳文は契約を満たす', () => {
  const src = '## Method\n\nWe optimize $\\Sigma$ as shown in Fig. 1.\n\n![](assets/fig1.jpeg)\n'
  const dst = '## 手法\n\n図 1 に示すとおり $\\Sigma$ を最適化する。\n\n![](assets/fig1.jpeg)\n'
  assert.deepEqual(checkContract(src, dst), [])
})

test('数式が変わったら見つける', () => {
  const src = 'We optimize $\\Sigma$.'
  const dst = '$シグマ$ を最適化する。'
  const b = checkContract(src, dst)
  assert.equal(b[0]?.kind, 'math')
  assert.deepEqual(b[0]?.missing, ['\\Sigma'])
})

test('数式が落ちたら見つける', () => {
  const b = checkContract('$$x = y$$ and $z$', '$$x = y$$')
  assert.equal(b[0]?.kind, 'math')
  assert.deepEqual(b[0]?.missing, ['z'])
})

test('表示の数式と文中の数式を取り違えない', () => {
  const src = '$$a$$ と $b$'
  assert.deepEqual(checkContract(src, '$$a$$ と $b$'), [])
})

test('図の参照が変わったら見つける', () => {
  const b = checkContract('![](assets/fig1.jpeg)', '![図 1](assets/zu1.jpeg)')
  assert.equal(b[0]?.kind, 'image')
  assert.deepEqual(b[0]?.missing, ['assets/fig1.jpeg'])
})

test('図の説明文だけが訳されるのは契約に反しない', () => {
  assert.deepEqual(checkContract('![Figure 1](assets/a.jpeg)', '![図 1](assets/a.jpeg)'), [])
})

test('リンクの行き先が変わったら見つける', () => {
  const b = checkContract('[paper](https://example.com/a)', '[論文](https://example.com/b)')
  assert.equal(b[0]?.kind, 'link')
})

test('画像の参照をリンクとして数えない', () => {
  assert.deepEqual(checkContract('![](a.png)', '![](a.png)'), [])
})

test('見出しの深さが変わったら見つける', () => {
  const b = checkContract('## Method', '### 手法')
  assert.equal(b[0]?.kind, 'heading')
  assert.deepEqual(b[0]?.missing, ['##'])
  assert.deepEqual(b[0]?.added, ['###'])
})

test('見出しの文言を訳すのは契約に反しない', () => {
  assert.deepEqual(checkContract('## Method', '## 手法'), [])
})

test('図の参照の位置が動くのは契約に反しない', () => {
  const src = 'text\n\n![](a.png)\n\nmore'
  const dst = '![](a.png)\n\n本文\n\n続き'
  assert.deepEqual(checkContract(src, dst), [])
})

test('複数の違反をまとめて返す', () => {
  const b = checkContract('## A\n\n$x$\n\n![](a.png)', '# あ\n\n$y$\n\n![](b.png)')
  assert.deepEqual(
    b.map((x) => x.kind).sort(),
    ['heading', 'image', 'math'],
  )
})

test('違反を人が読める形にする', () => {
  const b = checkContract('$\\Sigma$', '$シグマ$')
  assert.match(describeBreaches(b), /数式\(落ちた 1 件: \\Sigma \/ 増えた 1 件: シグマ\)/)
})
