import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Bbox, ConvertedBlock } from '../convert/types.ts'

export type TextLayer = {
  /** ページ全体の文字層。添字は 0 始まりのページ番号。 */
  pages: string[]
  /** ブロックの識別子から、その領域の文字層を引く。 */
  regions: Map<string, string>
}

export type TextLayerPaths = {
  python: string
  script: string
}

type Region = { id: string; page: number; bbox: Bbox }

/**
 * PDF の文字層を、ページと、変換器が返したブロックの領域ごとに取り出す。
 *
 * 領域ごとに引くのは、変換結果のどの部分が文字層のどの部分に当たるかを、
 * AI に探させないためである。2 段組みの紙面では文字層の読み順が段をまたいで
 * 混ざるので、対応づけ自体が誤りうる(0009)。
 */
export async function readTextLayer(
  pdf: string,
  blocks: ConvertedBlock[],
  paths: TextLayerPaths,
): Promise<TextLayer> {
  const regions: Region[] = blocks.map((b) => ({ id: b.id, page: b.page, bbox: b.bbox }))
  const dir = await mkdtemp(join(tmpdir(), 'pct-textlayer-'))
  try {
    const requestFile = join(dir, 'request.json')
    await writeFile(requestFile, JSON.stringify({ regions }), 'utf8')
    const raw = await run(paths.python, [paths.script, pdf, requestFile])
    return parseTextLayer(raw)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function parseTextLayer(text: string): TextLayer {
  const raw = JSON.parse(text) as Record<string, unknown>
  const pages = Array.isArray(raw['pages']) ? raw['pages'].map((p) => (typeof p === 'string' ? p : '')) : []
  const regions = new Map<string, string>()
  const rawRegions = raw['regions']
  if (typeof rawRegions === 'object' && rawRegions !== null) {
    for (const [id, value] of Object.entries(rawRegions as Record<string, unknown>)) {
      if (typeof value === 'string') regions.set(id, value)
    }
  }
  return { pages, regions }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err = `${err}${chunk.toString('utf8')}`.slice(-2000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`文字層を取り出せなかった (code=${code})\n${err.trimEnd()}`))
    })
  })
}
