import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { IndexDb } from '../db/index-db.ts'
import { Collection } from './collection.ts'
import { parseMessages, serializeMessages } from './chat.ts'
import { paperFile } from './layout.ts'
import { readPaper, writePaper, type PaperMeta } from './paper.ts'

let root: string
let dataDir: string
let index: IndexDb
let collection: Collection

const meta = (over: Partial<PaperMeta> = {}): PaperMeta => ({
  slug: 'mildenhall2020-nerf',
  title: 'NeRF: Representing Scenes as Neural Radiance Fields',
  authors: ['Ben Mildenhall', 'Pratul P. Srinivasan'],
  venue: 'ECCV',
  year: 2020,
  arxivId: '2003.08934',
  sourceUrl: 'https://arxiv.org/abs/2003.08934',
  pdfUrl: 'https://arxiv.org/pdf/2003.08934',
  tags: ['3d', 'rendering'],
  addedAt: '2026-07-27T10:00:00+09:00',
  ...over,
})

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pct-test-'))
  dataDir = join(root, 'data')
  index = new IndexDb(join(root, 'index.sqlite'))
  collection = new Collection(dataDir, index)
  await collection.ensureDirs()
})

after(async () => {
  collection.stopWatching()
  index.close()
  await rm(root, { recursive: true, force: true })
})

test('手で置いた paper.md が走査で索引に載る', async () => {
  await writePaper(dataDir, meta(), '# Introduction\n\n本文\n')

  const result = await collection.scan()
  assert.equal(result.papersIndexed, 1)
  assert.equal(index.countPapers(), 1)
  assert.deepEqual(index.tagCounts(), [
    { tag: '3d', count: 1 },
    { tag: 'rendering', count: 1 },
  ])
})

test('変わっていないファイルは読み直さない', async () => {
  const result = await collection.scan()
  assert.equal(result.papersIndexed, 0)
  assert.equal(index.countPapers(), 1)
})

test('frontmatter を直接編集すると索引に反映される', async () => {
  const file = paperFile(dataDir, 'mildenhall2020-nerf', 'body')
  const text = await readFile(file, 'utf8')
  await writeFile(file, text.replace('  - rendering', '  - rendering\n  - 読了'), 'utf8')

  const result = await collection.scan()
  assert.equal(result.papersIndexed, 1)
  assert.deepEqual(
    index.tagCounts().map((t) => t.tag).sort(),
    ['3d', 'rendering', '読了'],
  )
})

test('frontmatter だけの変更では埋め込みを作り直さない', async () => {
  index.markEmbeddingFresh('mildenhall2020-nerf')
  assert.deepEqual(index.staleEmbeddingSlugs(), [])

  const paper = await readPaper(dataDir, 'mildenhall2020-nerf')
  assert.ok(paper !== null)
  await writePaper(dataDir, { ...paper.meta, venue: 'ECCV 2020' }, paper.body)
  await collection.scan()

  assert.deepEqual(index.staleEmbeddingSlugs(), [])
})

test('本文が変わったら埋め込みを作り直す対象になる', async () => {
  const paper = await readPaper(dataDir, 'mildenhall2020-nerf')
  assert.ok(paper !== null)
  await writePaper(dataDir, paper.meta, `${paper.body}\n\n# Method\n\n追記した本文\n`)
  await collection.scan()

  assert.deepEqual(index.staleEmbeddingSlugs(), ['mildenhall2020-nerf'])
})

test('slug として扱えないディレクトリは無視する', async () => {
  await writeFile(join(dataDir, 'papers', '.DS_Store'), 'x', 'utf8')
  const result = await collection.scan()
  assert.equal(result.papersIndexed, 0)
  assert.equal(index.countPapers(), 1)
})

test('索引を捨てても markdown から作り直せる', async () => {
  index.reset()
  assert.equal(index.countPapers(), 0)

  const result = await collection.scan()
  assert.equal(result.papersIndexed, 1)
  assert.equal(index.countPapers(), 1)
  assert.deepEqual(
    index.tagCounts().map((t) => t.tag).sort(),
    ['3d', 'rendering', '読了'],
  )
})

test('論文を削除するとファイルも索引も消える', async () => {
  await collection.deletePaper('mildenhall2020-nerf')
  assert.equal(index.countPapers(), 0)
  assert.equal(await readPaper(dataDir, 'mildenhall2020-nerf'), null)
})

test('索引にあってファイルが消えた論文は走査で除去される', async () => {
  await writePaper(dataDir, meta({ slug: 'barron2021-mipnerf' }), '本文\n')
  await collection.scan()
  assert.equal(index.countPapers(), 1)

  await rm(join(dataDir, 'papers', 'barron2021-mipnerf'), { recursive: true, force: true })
  const result = await collection.scan()
  assert.equal(result.papersRemoved, 1)
  assert.equal(index.countPapers(), 0)
})

test('発言の区切りを役割と時刻の両方で判定する', () => {
  const messages = [
    { role: 'user' as const, at: '2026-07-27T15:04:12+09:00', text: '位置エンコーディングについて教えて' },
    {
      role: 'assistant' as const,
      at: '2026-07-27T15:04:40+09:00',
      text: '## 概要\n\n応答の中に見出しがあっても区切りとは見なさない。\n\n## user\n\nこれも本文である。',
    },
  ]
  assert.deepEqual(parseMessages(serializeMessages(messages)), messages)
})
