import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { readPaper, readPaperSideFile, writePaperSideFile } from '../data/paper.ts'
import { checkContract, describeBreaches } from './contract.ts'
import { buildTranslatePrompt, TRANSLATE_INSTRUCTIONS } from './prompt.ts'
import { joinSections, splitSections } from './sections.ts'

export type TranslateDeps = {
  dataDir: string
  codex: CodexClient
  model: string
  effort: string
  /** Codex の service tier。priority で速くなる代わりに利用量が増える。 */
  serviceTier: string | null
}

/** 契約に反したときにやり直す回数。 */
const RETRIES = 1

export type SectionOutcome = {
  index: number
  heading: string
  /** 契約に反したまま採用した場合の説明。守られていれば null。 */
  breach: string | null
}

/**
 * 1 つの節を訳す。
 *
 * 契約に反していたら、何が変わったかを添えて 1 度だけやり直す。
 * それでも反していれば、その訳を採ったうえで記録に残す。訳が無いより、
 * 契約に反する箇所が分かる訳があるほうがよい。
 */
async function translateSection(
  threadId: string,
  request: Parameters<typeof buildTranslatePrompt>[0],
  deps: TranslateDeps,
): Promise<{ markdown: string; breach: string | null }> {
  let breach: string | null = null
  let last = ''
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const prompt = breach === null ? request : { ...request, breach }
    const outcome = await runTurn(deps.codex, {
      threadId,
      input: textInput(buildTranslatePrompt(prompt)),
      effort: deps.effort,
    })
    last = outcome.text.trim()
    const breaches = checkContract(request.markdown, last)
    if (breaches.length === 0) return { markdown: last, breach: null }
    breach = describeBreaches(breaches)
  }
  return { markdown: last, breach }
}

/**
 * 論文 1 本の本文と abstract を訳す。
 *
 * 節ごとの要求を 1 つの作業スレッドの中で順に行う。同じスレッドに前の節の訳が
 * 残るため、専門用語の訳が論文の中で揃う(0004)。
 */
export async function translatePaper(slug: string, deps: TranslateDeps): Promise<SectionOutcome[]> {
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)
  const sections = splitSections(paper.body)

  const threadId = await startWorkThread(deps.codex, {
    instructions: TRANSLATE_INSTRUCTIONS,
    model: deps.model,
    serviceTier: deps.serviceTier,
  })

  // abstract は副次ファイルにある。無ければ本文だけを訳す。
  const abstract = ((await readPaperSideFile(deps.dataDir, slug, 'abstract')) ?? '').trim()
  const outcomes: SectionOutcome[] = []
  const parts: string[] = []
  for (const section of sections) {
    const result = await translateSection(
      threadId,
      {
        title: paper.meta.title,
        abstract,
        index: section.index,
        total: sections.length,
        markdown: section.markdown,
      },
      deps,
    )
    parts.push(result.markdown)
    outcomes.push({ index: section.index, heading: section.heading, breach: result.breach })
  }

  await writePaperSideFile(deps.dataDir, slug, 'bodyJa', joinSections(parts), 'ja')

  // abstract は 1 つの節として、同じスレッドの最後に訳す。本文で使った訳語が
  // そのまま使われる。
  if (abstract.length > 0) {
    const result = await translateSection(
      threadId,
      { title: paper.meta.title, abstract, index: sections.length, total: sections.length + 1, markdown: abstract },
      deps,
    )
    await writePaperSideFile(deps.dataDir, slug, 'abstractJa', `${result.markdown.trim()}\n`, 'ja')
    outcomes.push({ index: sections.length, heading: 'abstract', breach: result.breach })
  }

  return outcomes
}
