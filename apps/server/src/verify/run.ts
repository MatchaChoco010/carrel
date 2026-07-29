import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexClient } from '../codex/client.ts'
import { imageAndTextInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { parseDocument } from '../convert/runner.ts'
import { paperBlocksFile } from '../convert/store.ts'
import { paperFile, paperOriginalPdf, paperPagesDir } from '../data/layout.ts'
import { needsFocus, textGap } from './diff.ts'
import { buildPageWork, type PageWork } from './pages.ts'
import { buildVerifyPrompt, VERIFY_INSTRUCTIONS, VERIFY_OUTPUT_SCHEMA, type VerifyPageResult } from './prompt.ts'
import { buildReport, type PageReport } from './report.ts'
import { readTextLayer, type TextLayerPaths } from './textlayer.ts'

export type VerifyDeps = {
  dataDir: string
  codex: CodexClient
  model: string
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
  const threadId = await startWorkThread(deps.codex, {
    instructions: VERIFY_INSTRUCTIONS,
    model: deps.model,
  })
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: imageAndTextInput(imagePath, buildVerifyPrompt(work.input)),
    outputSchema: VERIFY_OUTPUT_SCHEMA,
  })
  const result = parsePageResult(outcome.text)
  if (result === null) throw new Error(`${work.page + 1} ページ目の照合が形の違う応答を返した`)
  return result
}

/**
 * 論文を 1 本照合し、`paper.md` と `verification.md` を書く。
 *
 * `paper.raw.md` は残す。照合前との差分を見られるようにするためである(0004)。
 */
export async function verifyPaper(slug: string, deps: VerifyDeps): Promise<void> {
  const document = parseDocument(await readFile(paperBlocksFile(deps.dataDir, slug), 'utf8'))
  const layer = await readTextLayer(paperOriginalPdf(deps.dataDir, slug), document.blocks, deps.textLayer)
  const work = buildPageWork(document, layer)

  const parts: string[] = []
  const reports: PageReport[] = []
  for (const page of work) {
    const result = await verifyPage(page, pageImageFile(deps.dataDir, slug, page.page), deps)
    if (result.markdown.trim().length > 0) parts.push(result.markdown.trim())

    // 照合を経ても残った文字の欠落を記録する。直ったかどうかは、この 1 つの
    // 事象に限れば機械的に確かめられる(0009)。測り方は照合の前と揃える。
    const after = textGap(layer.pages[page.page] ?? '', result.markdown)
    const remaining = needsFocus(after) ? after : null

    reports.push({ page: page.page, changes: result.changes, remaining })
  }

  await writeFile(paperFile(deps.dataDir, slug, 'body'), `${parts.join('\n\n')}\n`, 'utf8')
  await writeFile(paperFile(deps.dataDir, slug, 'verification'), buildReport(reports), 'utf8')
}
