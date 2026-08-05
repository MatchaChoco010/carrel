import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { paperOriginalPdf } from '../data/layout.ts'
import { fetchOriginal, looksLikePdf } from './fetch.ts'

/** 決められた中身を流す、最小の代役。 */
function fakeFetch(body: Buffer, contentType = 'application/pdf'): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': contentType } })) as unknown as typeof fetch
}

test('取れた原本を書き、大きさと content-type を返す', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-fetch-'))
  try {
    const body = Buffer.from('%PDF-1.7\n本文')
    const result = await fetchOriginal(root, 'kerbl2023-3dgs', 'https://example.com/a.pdf', 'pdf', {
      fetcher: fakeFetch(body),
    })
    assert.equal(result.bytes, body.byteLength)
    assert.equal(result.contentType, 'application/pdf')
    assert.equal(looksLikePdf(await readFile(result.path, { encoding: null })), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('上限を超えたら失敗し、書きかけを残さない', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-fetch-'))
  try {
    await assert.rejects(
      fetchOriginal(root, 'kerbl2023-3dgs', 'https://example.com/big.pdf', 'pdf', {
        fetcher: fakeFetch(Buffer.alloc(2048)),
        maxBytes: 1024,
      }),
      /大きすぎる/,
    )
    assert.equal(existsSync(paperOriginalPdf(root, 'kerbl2023-3dgs')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('応答が失敗なら取りに行かない', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carrel-fetch-'))
  try {
    const failing = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
    await assert.rejects(
      fetchOriginal(root, 'kerbl2023-3dgs', 'https://example.com/a.pdf', 'pdf', { fetcher: failing }),
      /取得できなかった \(403\)/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
