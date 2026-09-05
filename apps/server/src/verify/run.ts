import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inBatches } from '../batches.ts'
import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput } from '../codex/protocol.ts'
import { runTurn, withWorkThread } from '../codex/threads.ts'
import { parseDocument } from '../convert/runner.ts'
import { ASSETS_DIR_NAME, paperBlocksFile } from '../convert/store.ts'
import { paperFile, paperOriginalPdf, paperPagesDir } from '../data/layout.ts'
import { readPaper, writePaper } from '../data/paper.ts'
import { needsFocus, textGap } from './diff.ts'
import { buildPageWork, type PageWork } from './pages.ts'
import {
  buildVerifyPrompt,
  IMAGE_LINE,
  TRANSCRIBE_INSTRUCTIONS,
  VERIFY_INSTRUCTIONS,
  VERIFY_OUTPUT_SCHEMA,
  type VerifyPageResult,
} from './prompt.ts'
import { normalizeHeadingLevels } from '../convert/headings.ts'
import { joinSplitParagraphs } from '../convert/paragraphs.ts'
import { buildReport, type PageReport } from './report.ts'
import { readTextLayer, type TextLayerPaths } from './textlayer.ts'

export type VerifyDeps = {
  dataDir: string
  codex: CodexClient
  model: string
  effort: string
  serviceTier: string | null
  textLayer: TextLayerPaths
}

export function pageImageFile(dataDir: string, slug: string, page: number): string {
  return join(paperPagesDir(dataDir, slug), `${String(page).padStart(4, '0')}.png`)
}

/** 応答を読む。形は `outputSchema` で固定してあるが、届いたものは確かめる。 */
export function parsePageResult(text: string): VerifyPageResult | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (typeof value['markdown'] !== 'string') return null
  const changes = Array.isArray(value['changes'])
    ? value['changes'].filter((c): c is VerifyPageResult['changes'][number] => {
        if (typeof c !== 'object' || c === null) return false
        const change = c as Record<string, unknown>
        return typeof change['kind'] === 'string' && typeof change['reason'] === 'string'
      })
    : []
  return { markdown: value['markdown'], changes }
}

/**
 * 1 ページを照合する。
 *
 * 1 ページごとに使い捨てのスレッドを立てる。ページ同士に文脈の引き継ぎは要らず、
 * 前のページの内容が残っていると、そのページに無いものを補う方へ働きうる。
 */
async function verifyPage(work: PageWork, imagePath: string, deps: VerifyDeps): Promise<VerifyPageResult> {
  const outcome = await withWorkThread(
    deps.codex,
    {
      instructions: work.input.transcribe ? TRANSCRIBE_INSTRUCTIONS : VERIFY_INSTRUCTIONS,
      model: deps.model,
      serviceTier: deps.serviceTier,
    },
    (threadId) =>
      runTurn(deps.codex, {
        threadId,
        input: imagesAndTextInput([imagePath], buildVerifyPrompt(work.input)),
        outputSchema: VERIFY_OUTPUT_SCHEMA,
        effort: deps.effort,
      }),
  )
  const result = parsePageResult(outcome.text)
  if (result === null) throw new Error(`${work.page + 1} ページ目の照合が形の違う応答を返した`)
  return result
}

/**
 * 照合が落とした図の参照を戻す。
 *
 * 図の画像は紙面に文字として現れないので、残すよう指示していても落ちることが
 * ある。落ちた時点で位置は失われているため、そのページの末尾に置く。
 */
export function restoreImages(before: string, after: string): string {
  const wanted = before.match(IMAGE_LINE) ?? []
  if (wanted.length === 0) return after

  const kept = new Set(after.match(IMAGE_LINE) ?? [])
  const lost = wanted.filter((line) => !kept.has(line))
  if (lost.length === 0) return after

  return `${after.trimEnd()}\n\n${lost.join('\n\n')}`
}

/** 同時に照合するページ数。ページごとに使い捨てのスレッドを立てるので依存が無い。 */
const PAGES_AT_ONCE = 8

/**
 * 論文を 1 本照合し、`paper.md` と `verification.md` を書く。
 *
 * `paper.raw.md` は残す。照合前との差分を見られるようにするためである(0004)。
 */
export async function verifyPaper(slug: string, deps: VerifyDeps, signal?: AbortSignal): Promise<void> {
  const document = parseDocument(await readFile(paperBlocksFile(deps.dataDir, slug), 'utf8'))
  const layer = await readTextLayer(paperOriginalPdf(deps.dataDir, slug), document.blocks, deps.textLayer)
  const work = buildPageWork(document, layer, ASSETS_DIR_NAME)

  const done = await inBatches(work, PAGES_AT_ONCE, async (page) => {
    const result = await verifyPage(page, pageImageFile(deps.dataDir, slug, page.page), deps)
    const markdown = restoreImages(page.input.converted, result.markdown)

    // 照合を経ても残った文字の欠落を記録する。直ったかどうかは、この 1 つの
    // 事象に限れば機械的に確かめられる(0009)。測り方は照合の前と揃える。
    const after = textGap(layer.pages[page.page] ?? '', markdown)
    const remaining = needsFocus(after) ? after : null

    return { markdown, report: { page: page.page, changes: result.changes, remaining, transcribed: page.input.transcribe } }
  }, signal)

  const parts = done.map((d) => d.markdown.trim()).filter((text) => text.length > 0)
  const reports: PageReport[] = done.map((d) => d.report)

  const joined = joinSplitParagraphs(parts.join('\n\n'))
  const leveled = normalizeHeadingLevels(joined.markdown)

  // frontmatter が正なので(0002)、本文だけを差し替えて書き戻す。
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)
  await writePaper(deps.dataDir, paper.meta, `${leveled.markdown}\n`)
  await writeFile(
    paperFile(deps.dataDir, slug, 'verification'),
    buildReport(reports, { joined: joined.joined, releveled: leveled.releveled }),
    'utf8',
  )
}
