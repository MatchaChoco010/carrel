import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imageSource } from './imageSource.ts'

test('論文の図は @slug の参照から引く', () => {
  assert.deepEqual(imageSource('@kerbl2023-3dgs/assets/_page_3_Figure_1.jpeg', { chatId: 'c1' }), {
    kind: 'load',
    url: '/api/papers/kerbl2023-3dgs/assets/_page_3_Figure_1.jpeg',
  })
})

test('会話の添付は描いている会話から引く', () => {
  assert.deepEqual(imageSource('assets/3f9c1a2b8d04.png', { chatId: '20260731T001540-669cbb' }), {
    kind: 'load',
    url: '/api/chats/20260731T001540-669cbb/assets/3f9c1a2b8d04.png',
  })
})

test('論文の本文の中の assets は、その論文の図として引く', () => {
  assert.deepEqual(imageSource('assets/fig1.png', { slug: 'kerbl2023-3dgs' }), {
    kind: 'load',
    url: '/api/papers/kerbl2023-3dgs/assets/fig1.png',
  })
})

test('外の URL は読み込まない', () => {
  assert.deepEqual(imageSource('https://example.com/a.png', { chatId: 'c1' }), {
    kind: 'external',
    url: 'https://example.com/a.png',
  })
})

test('どこを指すか決まらない参照は解決しない', () => {
  // 会話を描いていないのに会話の添付を指している。
  assert.deepEqual(imageSource('assets/a.png', {}), { kind: 'unresolved', raw: 'assets/a.png' })
  assert.deepEqual(imageSource('../../secret.png', { chatId: 'c1' }), {
    kind: 'unresolved',
    raw: '../../secret.png',
  })
  assert.deepEqual(imageSource('/etc/passwd', { chatId: 'c1' }), { kind: 'unresolved', raw: '/etc/passwd' })
})

test('置き場所の外へ出る名前は解決しない', () => {
  assert.deepEqual(imageSource('assets/../../a.png', { chatId: 'c1' }), {
    kind: 'unresolved',
    raw: 'assets/../../a.png',
  })
  assert.deepEqual(imageSource('@slug/assets/../x.png', { chatId: 'c1' }), {
    kind: 'unresolved',
    raw: '@slug/assets/../x.png',
  })
})
