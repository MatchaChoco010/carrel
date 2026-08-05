import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  attachmentPaths,
  copyAttachments,
  referencedAttachments,
  storeImages,
  unsupportedImageType,
  withAttachments,
} from './attachments.ts'

const png = (byte: number): Uint8Array => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, byte])

async function chatDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'carrel-attach-'))
  return join(root, 'chats/2026/07/31/20260731T120000-abc123')
}

test('添付は会話のディレクトリの assets へ置く', async () => {
  const dir = await chatDir()
  try {
    const stored = await storeImages(join(dir, 'chat.md'), [{ name: '図.png', type: 'image/png', bytes: png(1) }])

    assert.equal(stored.length, 1)
    assert.match(stored[0]?.ref ?? '', /^assets\/[0-9a-f]{12}\.png$/)
    assert.equal(stored[0]?.file, join(dir, 'assets', (stored[0]?.ref ?? '').replace('assets/', '')))
    assert.deepEqual(new Uint8Array(await readFile(stored[0]?.file ?? '')), png(1))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('同じ画像を二度置いても実体は 1 つになる', async () => {
  const dir = await chatDir()
  try {
    const file = join(dir, 'chat.md')
    const first = await storeImages(file, [{ name: 'a.png', type: 'image/png', bytes: png(1) }])
    const second = await storeImages(file, [{ name: 'b.png', type: 'image/png', bytes: png(1) }])

    assert.equal(first[0]?.ref, second[0]?.ref)
    assert.deepEqual(await readdir(join(dir, 'assets')), [(first[0]?.ref ?? '').replace('assets/', '')])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('中身が違えば別の名前になる', async () => {
  const dir = await chatDir()
  try {
    const file = join(dir, 'chat.md')
    const stored = await storeImages(file, [
      { name: 'a.png', type: 'image/png', bytes: png(1) },
      { name: 'b.png', type: 'image/png', bytes: png(2) },
    ])

    assert.notEqual(stored[0]?.ref, stored[1]?.ref)
    assert.equal((await readdir(join(dir, 'assets'))).length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('扱わない形式は断る', async () => {
  assert.equal(unsupportedImageType('image/svg+xml'), true)
  assert.equal(unsupportedImageType('image/png'), false)

  const dir = await chatDir()
  try {
    await assert.rejects(
      () => storeImages(join(dir, 'chat.md'), [{ name: 'a.svg', type: 'image/svg+xml', bytes: png(1) }]),
      /扱わない形式/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('参照は本文の先頭に並ぶ', () => {
  const stored = [
    { ref: 'assets/aaa.png', file: '/x/assets/aaa.png', name: '図 1.png' },
    { ref: 'assets/bbb.png', file: '/x/assets/bbb.png', name: '' },
  ]

  assert.equal(
    withAttachments('この図について教えて。', stored),
    '![図 1.png](assets/aaa.png)\n![](assets/bbb.png)\n\nこの図について教えて。',
  )
  assert.equal(withAttachments('', stored), '![図 1.png](assets/aaa.png)\n![](assets/bbb.png)')
  assert.equal(withAttachments('本文だけ', []), '本文だけ')
})

test('発言が参照している添付を、出てきた順に重複なく返す', () => {
  const names = referencedAttachments([
    { text: '![a](assets/aaa.png)\n\n見て。' },
    { text: '外の画像 ![x](https://example.com/x.png) と ![b](./assets/bbb.jpg)' },
    { text: 'もう一度 ![a](assets/aaa.png)' },
    { text: '論文の図 ![図](@kerbl2023-3dgs/assets/fig.png)' },
  ])

  assert.deepEqual(names, ['aaa.png', 'bbb.jpg'])
})

test('実体のある添付だけを渡す', async () => {
  const dir = await chatDir()
  try {
    const file = join(dir, 'chat.md')
    const stored = await storeImages(file, [{ name: 'a.png', type: 'image/png', bytes: png(1) }])
    const name = (stored[0]?.ref ?? '').replace('assets/', '')

    assert.deepEqual(await attachmentPaths(file, [name, '無い.png']), [stored[0]?.file])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('分岐先へ添付を複製する', async () => {
  const from = await chatDir()
  const to = join(from, '..', '20260731T130000-def456')
  try {
    const fromFile = join(from, 'chat.md')
    const stored = await storeImages(fromFile, [{ name: 'a.png', type: 'image/png', bytes: png(3) }])
    const name = (stored[0]?.ref ?? '').replace('assets/', '')

    await copyAttachments(fromFile, join(to, 'chat.md'), [name])

    assert.deepEqual(new Uint8Array(await readFile(join(to, 'assets', name))), png(3))
    assert.deepEqual(new Uint8Array(await readFile(stored[0]?.file ?? '')), png(3), '分岐元は残る')
  } finally {
    await rm(from, { recursive: true, force: true })
    await rm(to, { recursive: true, force: true })
  }
})
