import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { readPaper } from '../data/paper.ts'
import { writeReferences, type Reference } from '../data/references.ts'
import { buildReferencesPrompt, REFERENCES_INSTRUCTIONS, REFERENCES_SCHEMA } from './prompt.ts'
import { referencesSection } from './section.ts'

export type ReferencesDeps = {
  dataDir: string
  codex: CodexClient
  model: string
  effort: string
  serviceTier: string | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * 応答を参考文献の並びに直す。
 *
 * 原文が無い項目は落とす。画面に出すのは原文なので、それが無ければ 1 件として扱えない。
 */
export function parseReferences(text: string): Reference[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const entries = (raw as Record<string, unknown>)['entries']
  if (!Array.isArray(entries)) return null

  const references: Reference[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const value = asString(e['text'])
    if (value === null) continue
    references.push({
      text: value,
      title: asString(e['title']) ?? value,
      authors: Array.isArray(e['authors'])
        ? e['authors'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim())
        : [],
      year: typeof e['year'] === 'number' && Number.isInteger(e['year']) ? e['year'] : null,
      arxivId: asString(e['arxivId']),
      doi: asString(e['doi']),
      url: asString(e['url']),
      kind: e['kind'] === 'other' ? 'other' : 'paper',
    })
  }
  return references
}

/**
 * 参考文献の節を 1 件ずつに直して `references.md` に書く。
 *
 * 割るところから Codex に任せる。形は出版元ごとに違い、機械的な取り出しは形ごとに
 * 壊れるためである(0015)。
 */
export async function structureReferences(slug: string, deps: ReferencesDeps): Promise<Reference[]> {
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)

  const section = referencesSection(paper.body)
  // 参考文献を持たない論文もある。走ったことが分かるように空で書く。
  if (section === null) {
    await writeReferences(deps.dataDir, slug, [])
    return []
  }

  const threadId = await startWorkThread(deps.codex, {
    instructions: REFERENCES_INSTRUCTIONS,
    model: deps.model,
    serviceTier: deps.serviceTier,
  })
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(buildReferencesPrompt(section)),
    effort: deps.effort,
    outputSchema: REFERENCES_SCHEMA,
  })

  const references = parseReferences(outcome.text)
  if (references === null) throw new Error(`参考文献を JSON として読めなかった: ${slug}`)

  await writeReferences(deps.dataDir, slug, references)
  return references
}
