import { inBatches } from '../batches.ts'
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
  serviceTier: string | null
}

/** abstract の節に付ける見出し。本文の見出しと重ならない値を使う。 */
const ABSTRACT_HEADING = 'abstract'

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
  request: Parameters<typeof buildTranslatePrompt>[0],
  deps: TranslateDeps,
): Promise<{ markdown: string; breach: string | null }> {
  const threadId = await startWorkThread(deps.codex, {
    instructions: TRANSLATE_INSTRUCTIONS,
    model: deps.model,
    serviceTier: deps.serviceTier,
  })
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

/** 同時に訳す節の数。 */
const SECTIONS_AT_ONCE = 8

/** 訳し終えた節。abstract も 1 つの節として同じ並びに入る。 */
type Translated = SectionOutcome & { markdown: string }

/** 論文 1 本の本文と abstract を訳す。 */
export async function translatePaper(slug: string, deps: TranslateDeps): Promise<SectionOutcome[]> {
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)
  const sections = splitSections(paper.body)

  // abstract は副次ファイルにある。無ければ本文だけを訳す。
  const abstract = ((await readPaperSideFile(deps.dataDir, slug, 'abstract')) ?? '').trim()
  const total = abstract.length > 0 ? sections.length + 1 : sections.length

  const work = sections.map((section) => ({
    heading: section.heading,
    request: {
      title: paper.meta.title,
      abstract,
      index: section.index,
      total,
      markdown: section.markdown,
    },
  }))
  if (abstract.length > 0) {
    work.push({
      heading: ABSTRACT_HEADING,
      request: { title: paper.meta.title, abstract, index: sections.length, total, markdown: abstract },
    })
  }

  const done: Translated[] = await inBatches(work, SECTIONS_AT_ONCE, async (item) => {
    const result = await translateSection(item.request, deps)
    return { index: item.request.index, heading: item.heading, ...result }
  })

  const body = done.filter((d) => d.heading !== ABSTRACT_HEADING)
  await writePaperSideFile(deps.dataDir, slug, 'bodyJa', joinSections(body.map((d) => d.markdown)), 'ja')

  const translatedAbstract = done.find((d) => d.heading === ABSTRACT_HEADING)
  if (translatedAbstract !== undefined) {
    await writePaperSideFile(deps.dataDir, slug, 'abstractJa', `${translatedAbstract.markdown.trim()}\n`, 'ja')
  }

  return done.map(({ index, heading, breach }) => ({ index, heading, breach }))
}
