import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  root = await mkdtemp(join(tmpdir(), 'carrel-test-'))
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

/**
 * 監視の試験は別の一時ディレクトリで行う。
 *
 * 通知が届くまでの待ちがあるので、他の試験の索引を触らないように分ける。
 */
async function watched(): Promise<{
  dataDir: string
  index: IndexDb
  collection: Collection
  changed: string[]
  close: () => Promise<void>
}> {
  const dir = await mkdtemp(join(tmpdir(), 'carrel-watch-'))
  const db = new IndexDb(join(dir, 'index.sqlite'))
  const data = join(dir, 'data')
  const changed: string[] = []
  const target = new Collection(data, db, { onChatChanged: (path) => changed.push(path) })
  await target.ensureDirs()
  return {
    dataDir: data,
    index: db,
    collection: target,
    changed,
    close: async () => {
      target.stopWatching()
      db.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const chatFile = (title: string, body: string): string =>
  [
    '---',
    'id: chats/2026/07/30/09-00-00-watch.md',
    'created: 2026-07-30T09:00:00+09:00',
    'updated: 2026-07-30T09:00:00+09:00',
    `title: ${title}`,
    'title_source: user',
    'summary: ""',
    'archived: false',
    'codex_thread_id: null',
    'model: null',
    'effort: null',
    'papers: []',
    'forked_from: null',
    '---',
    '',
    '## user · 2026-07-30T09:00:00+09:00',
    '',
    body,
    '',
  ].join('\n')

/** 通知と索引の更新を待つ。 */
const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function replace(path: string, text: string): Promise<void> {
  // エディタの保存と同じ形。一時ファイルへ書いてから置き換える。
  await writeFile(`${path}.tmp`, text, 'utf8')
  await rename(`${path}.tmp`, path)
}

test('置き換えを繰り返しても、そのたびに索引へ反映される', async () => {
  const h = await watched()
  try {
    const day = join(h.dataDir, 'chats', '2026', '07', '30')
    await mkdir(day, { recursive: true })
    const file = join(day, '09-00-00-watch.md')
    await writeFile(file, chatFile('はじめ', '本文'), 'utf8')
    await h.collection.scan()

    h.collection.startWatching(30)
    await settle()

    for (const title of ['1 回目', '2 回目', '3 回目']) {
      await replace(file, chatFile(title, '本文'))
      await settle()
      const row = h.index.listChats().find((c) => c.path.endsWith('09-00-00-watch.md'))
      assert.equal(row?.title, title)
    }
  } finally {
    await h.close()
  }
})

test('監視を始めた後に作られた日付のディレクトリのファイルも拾う', async () => {
  const h = await watched()
  try {
    h.collection.startWatching(30)
    await settle()

    const day = join(h.dataDir, 'chats', '2026', '08', '01')
    await mkdir(day, { recursive: true })
    const file = join(day, '10-00-00-later.md')
    await writeFile(file, chatFile('後から', '本文'), 'utf8')
    await settle(800)

    assert.equal(h.index.listChats().length, 1)
    assert.ok(h.changed.length > 0)
  } finally {
    await h.close()
  }
})

test('ディレクトリごとに監視を張る', async () => {
  const h = await watched()
  try {
    await mkdir(join(h.dataDir, 'chats', '2026', '07', '30'), { recursive: true })
    await mkdir(join(h.dataDir, 'papers', 'kerbl2023-3dgs'), { recursive: true })

    h.collection.startWatching(30)
    await settle()

    // papers、papers/<slug>、chats、chats/2026、chats/2026/07、chats/2026/07/30
    assert.equal(h.collection.watchedDirs, 6)
  } finally {
    await h.close()
  }
})
