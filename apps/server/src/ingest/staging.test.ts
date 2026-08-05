import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { readStaged, removeStaged, safeName, stageOriginal, sweepStaged, uploadsDir } from './staging.ts'

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'carrel-staging-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function pdf(size = 32): Readable {
  const body = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size, 0x41)])
  return Readable.from([body])
}

test('原本を預かって引ける', async () => {
  await withDir(async (dir) => {
    const staged = await stageOriginal(dir, 'Some Paper.pdf', pdf())
    assert.equal(staged.name, 'Some Paper.pdf')
    assert.equal(staged.bytes, 41)

    const head = await readFile(staged.path)
    assert.equal(head.subarray(0, 5).toString('latin1'), '%PDF-')

    const read = await readStaged(dir, staged.id)
    assert.deepEqual(read, staged)
  })
})

test('PDF でないものは断り、書きかけを残さない', async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      () => stageOriginal(dir, 'page.html', Readable.from([Buffer.from('<!doctype html><html></html>')])),
      /PDF ではない/,
    )
    const read = await readStaged(dir, 'なんでもよい')
    assert.equal(read, null)
    await assert.rejects(() => stat(join(uploadsDir(dir), 'なんでもよい.pdf')))
  })
})

test('上限を超える原本は断る', async () => {
  await withDir(async (dir) => {
    await assert.rejects(() => stageOriginal(dir, 'big.pdf', pdf(1024), { maxBytes: 64 }), /大きすぎる/)
  })
})

test('預かった原本を捨てられる', async () => {
  await withDir(async (dir) => {
    const staged = await stageOriginal(dir, 'paper.pdf', pdf())
    await removeStaged(dir, staged.id)
    assert.equal(await readStaged(dir, staged.id), null)
  })
})

test('古い預かりだけを掃く', async () => {
  await withDir(async (dir) => {
    const old = await stageOriginal(dir, 'old.pdf', pdf())
    const fresh = await stageOriginal(dir, 'fresh.pdf', pdf())
    const long = 25 * 60 * 60 * 1000
    const past = new Date(Date.now() - long)
    await utimes(old.path, past, past)

    assert.equal(await sweepStaged(dir), 1)
    assert.equal(await readStaged(dir, old.id), null)
    assert.notEqual(await readStaged(dir, fresh.id), null)
  })
})

test('置き場が無ければ掃いても何も起きない', async () => {
  await withDir(async (dir) => {
    assert.equal(await sweepStaged(join(dir, 'まだ無い')), 0)
  })
})

test('掃くのは原本だけで、隣のファイルは触らない', async () => {
  await withDir(async (dir) => {
    const staged = await stageOriginal(dir, 'paper.pdf', pdf())
    const other = join(uploadsDir(dir), 'memo.txt')
    await writeFile(other, 'これは原本ではない', 'utf8')
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(staged.path, past, past)

    assert.equal(await sweepStaged(dir), 1)
    assert.equal(await readFile(other, 'utf8'), 'これは原本ではない')
  })
})

test('ファイルの名前から経路になる文字を落とす', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('C:\\Users\\me\\paper.pdf'), 'paper.pdf')
  assert.equal(safeName('   '), 'original.pdf')
  assert.equal(safeName('論文 (最終版).pdf'), '論文 (最終版).pdf')
})
