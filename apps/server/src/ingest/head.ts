import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readTextLayer } from '../verify/textlayer.ts'

const run = promisify(execFile)

/** 先頭から読むページ数。表紙が付いていることがあるので 1 ページでは足りない(0021)。 */
export const HEAD_PAGES = 2

export type HeadPaths = {
  python: string
  /** 文字層を取り出す script。 */
  textLayer: string
  /** ページを画像にする script。 */
  pages: string
}

/**
 * 原本の先頭。
 *
 * 文字層があればその文字を、無ければページの画像を渡す。走査しただけの論文のために
 * 取り込みの経路を分けない(0010)。
 */
export type OriginalHead =
  | { kind: 'text'; text: string }
  | { kind: 'images'; files: string[]; dispose: () => Promise<void> }

/** これだけの文字を持たない先頭は、文字が埋め込まれていないとみなす。 */
const MIN_CHARS = 40

/**
 * 原本の先頭を、書誌を読み取れる形で取り出す。
 *
 * 画像で返したときは、使い終わりに `dispose` を呼んで描き起こしたページを捨てる。
 */
export async function readOriginalHead(pdf: string, paths: HeadPaths): Promise<OriginalHead> {
  const layer = await readTextLayer(pdf, [], { python: paths.python, script: paths.textLayer })
  const text = layer.pages
    .slice(0, HEAD_PAGES)
    .join('\n\n---- ページの区切り ----\n\n')
    .trim()
  if (text.length >= MIN_CHARS) return { kind: 'text', text }

  const dir = await mkdtemp(join(tmpdir(), 'carrel-head-'))
  const wanted = Array.from({ length: HEAD_PAGES }, (_, i) => i).join(',')
  const { stdout } = await run(paths.python, [paths.pages, pdf, dir, '--pages', wanted], {
    maxBuffer: 16 * 1024 * 1024,
  })
  const parsed = JSON.parse(stdout) as { files?: unknown }
  const files = Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === 'string') : []
  return { kind: 'images', files, dispose: () => rm(dir, { recursive: true, force: true }) }
}

/**
 * 原本のページ数(#328)。
 *
 * 紙面を開かずに数えるので、何百ページある原本でも軽い。
 */
export async function countPages(pdf: string, paths: Pick<HeadPaths, 'python' | 'pages'>): Promise<number> {
  const { stdout } = await run(paths.python, [paths.pages, pdf, '--count'])
  const parsed = JSON.parse(stdout) as { pages?: unknown }
  if (typeof parsed.pages !== 'number') throw new Error(`ページ数を読めなかった: ${stdout}`)
  return parsed.pages
}
