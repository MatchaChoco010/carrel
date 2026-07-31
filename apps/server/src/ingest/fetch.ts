import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { paperDir, paperOriginalPdf } from '../data/layout.ts'
import type { SourceKind } from './types.ts'

/**
 * 1 本の原本として受け取る上限。これを超えるものは論文ではないとみなす。
 *
 * 図の多い論文は 100 MB を超える(実測で 136 MB の論文がある)。
 */
const MAX_BYTES = 512 * 1024 * 1024

export type FetchResult = {
  path: string
  bytes: number
  contentType: string | null
}

export type FetchOptions = {
  /** 受け取る上限。試験からは小さい値を渡す。 */
  maxBytes?: number
  fetcher?: typeof fetch
}

export async function fetchOriginal(
  dataDir: string,
  slug: string,
  url: string,
  kind: SourceKind,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const response = await (options.fetcher ?? fetch)(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'pct/0.1 (paper collection tool)' },
  })
  if (!response.ok) throw new Error(`原本を取得できなかった (${response.status}): ${url}`)
  if (response.body === null) throw new Error(`原本の中身が返らなかった: ${url}`)

  const contentType = response.headers.get('content-type')
  await mkdir(paperDir(dataDir, slug), { recursive: true })

  const path = kind === 'pdf' ? paperOriginalPdf(dataDir, slug) : join(paperDir(dataDir, slug), 'original.html')

  // 書きながら数える。丸ごとメモリに載せると、大きな原本でそのぶんの山ができる。
  let bytes = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        done(new Error(`原本が大きすぎる (${maxBytes} バイトを超えた): ${url}`))
        return
      }
      done(null, chunk)
    },
  })

  try {
    await pipeline(response.body, count, createWriteStream(path))
  } catch (error) {
    // 途中まで書いたものを残すと、次の段階が壊れた PDF を読む。
    await rm(path, { force: true })
    throw error
  }

  return { path, bytes, contentType }
}

/**
 * 取得したファイルが本当に PDF かを、先頭の印で確かめる。
 *
 * PDF のつもりで HTML のエラーページを保存すると、変換の段階まで気づけない。
 */
export function looksLikePdf(head: Buffer): boolean {
  return head.subarray(0, 5).toString('latin1') === '%PDF-'
}
