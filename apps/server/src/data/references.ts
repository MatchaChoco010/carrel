import { readFile } from 'node:fs/promises'
import { joinDocument, splitDocument } from './frontmatter.ts'
import { paperFile } from './layout.ts'
import { writeAtomicFile } from './write.ts'

/** 論文として取り込めるものと、それ以外(web ページ・規格・道具の説明)。 */
export type ReferenceKind = 'paper' | 'other'

export type Reference = {
  /** 論文に書かれていたままの 1 件。画面に出すのはこれ(0015)。 */
  text: string
  title: string
  authors: string[]
  year: number | null
  arxivId: string | null
  doi: string | null
  url: string | null
  kind: ReferenceKind
}

export type PaperReferences = {
  slug: string
  references: Reference[]
}

const KEYS = {
  text: 'text',
  title: 'title',
  authors: 'authors',
  year: 'year',
  arxivId: 'arxiv_id',
  doi: 'doi',
  url: 'url',
  kind: 'kind',
} as const

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
}

function asYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return Number(value)
  return null
}

function parseReference(raw: unknown): Reference | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = asString(r[KEYS.text])
  if (text === null) return null
  return {
    text,
    title: asString(r[KEYS.title]) ?? text,
    authors: asStringArray(r[KEYS.authors]),
    year: asYear(r[KEYS.year]),
    arxivId: asString(r[KEYS.arxivId]),
    doi: asString(r[KEYS.doi]),
    url: asString(r[KEYS.url]),
    kind: r[KEYS.kind] === 'other' ? 'other' : 'paper',
  }
}

function serializeReference(reference: Reference): Record<string, unknown> {
  return {
    [KEYS.text]: reference.text,
    [KEYS.title]: reference.title,
    [KEYS.authors]: reference.authors,
    [KEYS.year]: reference.year,
    [KEYS.arxivId]: reference.arxivId,
    [KEYS.doi]: reference.doi,
    [KEYS.url]: reference.url,
    [KEYS.kind]: reference.kind,
  }
}

/**
 * 参考文献を読む。まだ段階が走っていなければ null を返す。
 *
 * 本文を持たないのは、これが人に読ませる文章ではなく画面が使うデータだからである(0015)。
 */
export async function readReferences(dataDir: string, slug: string): Promise<PaperReferences | null> {
  let text: string
  try {
    text = await readFile(paperFile(dataDir, slug, 'references'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const { meta } = splitDocument(text)
  const raw = meta['references']
  return {
    slug: asString(meta['slug']) ?? slug,
    references: (Array.isArray(raw) ? raw : []).map(parseReference).filter((r): r is Reference => r !== null),
  }
}

export async function writeReferences(dataDir: string, slug: string, references: Reference[]): Promise<void> {
  const text = joinDocument({
    meta: { slug, references: references.map(serializeReference) },
    body: '',
  })
  await writeAtomicFile(paperFile(dataDir, slug, 'references'), text)
}
