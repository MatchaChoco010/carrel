import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeHeadingLevels } from './headings.ts'

test('番号の深さに合わせて階層を直す', () => {
  const result = normalizeHeadingLevels(
    ['# 3 Training Data', '## 4.1 Architecture Details', '### 2.2.1 What the driver takes back'].join('\n'),
  )

  assert.equal(
    result.markdown,
    ['## 3 Training Data', '### 4.1 Architecture Details', '#### 2.2.1 What the driver takes back'].join('\n'),
  )
  assert.equal(result.releveled, 3)
})

test('合っている見出しはそのまま', () => {
  const text = ['## 1 Introduction', '### 1.1 Motivation', '#### 1.1.1 Detail'].join('\n')
  const result = normalizeHeadingLevels(text)

  assert.equal(result.markdown, text)
  assert.equal(result.releveled, 0)
})

test('番号を持たない見出しは触らない', () => {
  const text = ['# Wonder: Video World Model Done Better', '## Abstract', '## References', '### ACM Reference Format:'].join(
    '\n',
  )

  assert.equal(normalizeHeadingLevels(text).markdown, text)
})

test('数字で始まる題を番号と取り違えない', () => {
  const text = '# 3D Gaussian Splatting for Real-Time Radiance Field Rendering'

  assert.equal(normalizeHeadingLevels(text).markdown, text)
})

test('コードブロックの中の行は見出しにしない', () => {
  const text = ['```sh', '# 3 これは注釈', '```'].join('\n')

  assert.equal(normalizeHeadingLevels(text).markdown, text)
})

test('深い番号でも 6 段までに収める', () => {
  const result = normalizeHeadingLevels('# 1.2.3.4.5.6.7 Deep')

  assert.equal(result.markdown, '###### 1.2.3.4.5.6.7 Deep')
})

test('見出しの本文はそのまま残す', () => {
  const result = normalizeHeadingLevels('## 4.1 SH gradient $\\nabla Y_l^m$ using SSH')

  assert.equal(result.markdown, '### 4.1 SH gradient $\\nabla Y_l^m$ using SSH')
})

test('本文の行は変えない', () => {
  const text = ['## 2 Related Work', '', 'Recent work [Fridovich-Keil et al. 2022] shows 3 things.'].join('\n')

  assert.equal(normalizeHeadingLevels(text).markdown, text)
})
