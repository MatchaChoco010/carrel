import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paperDir, paperOriginalPdf } from '../data/layout.ts'
import type { SourceKind } from './types.ts'

/** 1 本の原本として受け取る上限。これを超えるものは論文ではないとみなす。 */
const MAX_BYTES = 100 * 1024 * 1024

export type FetchResult = {
  path: string
  bytes: number
  contentType: string | null
}

export async function fetchOriginal(
  dataDir: string,
  slug: string,
  url: string,
  kind: SourceKind,
): Promise<FetchResult> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'pct/0.1 (paper collection tool)' },
  })
  if (!response.ok) throw new Error(`原本を取得できなかった (${response.status}): ${url}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`原本が大きすぎる (${buffer.byteLength} バイト): ${url}`)
  }

  const contentType = response.headers.get('content-type')
  await mkdir(paperDir(dataDir, slug), { recursive: true })

  const path = kind === 'pdf' ? paperOriginalPdf(dataDir, slug) : join(paperDir(dataDir, slug), 'original.html')
  await writeFile(path, buffer)

  return { path, bytes: buffer.byteLength, contentType }
}

/**
 * 取得したファイルが本当に PDF かを、先頭の印で確かめる。
 *
 * PDF のつもりで HTML のエラーページを保存すると、変換の段階まで気づけない。
 */
export function looksLikePdf(head: Buffer): boolean {
  return head.subarray(0, 5).toString('latin1') === '%PDF-'
}
