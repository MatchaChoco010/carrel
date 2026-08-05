import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { paperDir } from '../data/layout.ts'
import { planResume } from './pipeline.ts'
import type { IngestRecord } from './store.ts'

const RECORD: IngestRecord = {
  slug: 'iwasaki2014-cloth',
  sourceUrl: 'https://example.org/paper',
  arxivId: null,
  originalUrl: 'https://example.org/paper.pdf',
  title: 'Interactive Cloth Rendering',
  doi: null,
  stage: 'fetch',
  status: 'failed',
  startedAt: 0,
  updatedAt: 0,
  lastError: '原本を取得できなかった',
}

async function withPaper(files: string[], run: (dataDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'carrel-resume-'))
  try {
    await mkdir(paperDir(dir, RECORD.slug), { recursive: true })
    for (const file of files) await writeFile(join(paperDir(dir, RECORD.slug), file), 'x', 'utf8')
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('原本を持たない取り込みは、解決からやり直す', async () => {
  await withPaper(['paper.md'], async (dir) => {
    assert.deepEqual(await planResume(dir, RECORD), { kind: 'restart', target: RECORD.sourceUrl })
  })
})

test('手元から入れた原本は、置き場に残っていないのでやり直せない', async () => {
  await withPaper(['paper.md'], async (dir) => {
    const plan = await planResume(dir, { ...RECORD, sourceUrl: 'upload:abc/paper.pdf' })
    assert.equal(plan.kind, 'unavailable')
  })
})

test('原本があれば変換から続ける', async () => {
  await withPaper(['paper.md', 'original.pdf'], async (dir) => {
    assert.deepEqual(await planResume(dir, RECORD), {
      kind: 'continue',
      slug: RECORD.slug,
      stage: 'convert',
    })
  })
})

test('変換が済んでいれば照合から続ける', async () => {
  await withPaper(['paper.md', 'original.pdf', 'paper.raw.md'], async (dir) => {
    const plan = await planResume(dir, RECORD)
    assert.equal(plan.kind === 'continue' ? plan.stage : null, 'verify')
  })
})

test('照合が済んでいれば書誌から続ける', async () => {
  await withPaper(['paper.md', 'original.pdf', 'paper.raw.md', 'verification.md'], async (dir) => {
    const plan = await planResume(dir, RECORD)
    assert.equal(plan.kind === 'continue' ? plan.stage : null, 'bibliography')
  })
})

test('翻訳が済んでいれば参考文献から続ける', async () => {
  await withPaper(['paper.md', 'original.pdf', 'paper.raw.md', 'verification.md', 'paper.ja.md'], async (dir) => {
    const plan = await planResume(dir, RECORD)
    assert.equal(plan.kind === 'continue' ? plan.stage : null, 'references')
  })
})

test('参考文献まで済んでいれば登録から続ける', async () => {
  const files = ['paper.md', 'original.pdf', 'paper.raw.md', 'verification.md', 'paper.ja.md', 'references.md']
  await withPaper(files, async (dir) => {
    const plan = await planResume(dir, RECORD)
    assert.equal(plan.kind === 'continue' ? plan.stage : null, 'register')
  })
})
