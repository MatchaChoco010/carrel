import { createHash } from 'node:crypto'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { EPOCH_ISO_DATE_TIME, parseIsoDateTime, type IsoDateTime } from './datetime.ts'
import { joinDocument, splitDocument } from './frontmatter.ts'
import { paperDir, paperFile, papersDir, type PaperFileKind } from './layout.ts'
import { isValidSlug } from './slug.ts'
import { writeAtomicFile } from './write.ts'

export type PaperMeta = {
  slug: string
  title: string
  authors: string[]
  venue: string | null
  year: number | null
  arxivId: string | null
  /** 出版元が付けた識別子。参考文献との突き合わせに使う(0015)。 */
  doi: string | null
  sourceUrl: string | null
  pdfUrl: string | null
  tags: string[]
  addedAt: IsoDateTime
}

export type Paper = {
  meta: PaperMeta
  body: string
  /** `paper.md` の最終更新時刻(ミリ秒)。 */
  mtimeMs: number
  /** 本文だけのハッシュ。frontmatter の変更と本文の変更を見分けるのに使う。 */
  bodyHash: string
}

const FRONTMATTER_KEYS = {
  slug: 'slug',
  title: 'title',
  authors: 'authors',
  venue: 'venue',
  year: 'year',
  arxivId: 'arxiv_id',
  doi: 'doi',
  sourceUrl: 'source_url',
  pdfUrl: 'pdf_url',
  tags: 'tags',
  addedAt: 'added_at',
} as const

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

function asYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return Number(value)
  return null
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function parsePaperMeta(raw: Record<string, unknown>, fallbackSlug: string): PaperMeta {
  return {
    slug: asString(raw[FRONTMATTER_KEYS.slug]) ?? fallbackSlug,
    title: asString(raw[FRONTMATTER_KEYS.title]) ?? fallbackSlug,
    authors: asStringArray(raw[FRONTMATTER_KEYS.authors]),
    venue: asString(raw[FRONTMATTER_KEYS.venue]),
    year: asYear(raw[FRONTMATTER_KEYS.year]),
    arxivId: asString(raw[FRONTMATTER_KEYS.arxivId]),
    doi: asString(raw[FRONTMATTER_KEYS.doi]),
    sourceUrl: asString(raw[FRONTMATTER_KEYS.sourceUrl]),
    pdfUrl: asString(raw[FRONTMATTER_KEYS.pdfUrl]),
    tags: asStringArray(raw[FRONTMATTER_KEYS.tags]),
    addedAt: parseIsoDateTime(raw[FRONTMATTER_KEYS.addedAt]) ?? EPOCH_ISO_DATE_TIME,
  }
}

export function serializePaperMeta(meta: PaperMeta): Record<string, unknown> {
  return {
    [FRONTMATTER_KEYS.slug]: meta.slug,
    [FRONTMATTER_KEYS.title]: meta.title,
    [FRONTMATTER_KEYS.authors]: meta.authors,
    [FRONTMATTER_KEYS.venue]: meta.venue,
    [FRONTMATTER_KEYS.year]: meta.year,
    [FRONTMATTER_KEYS.arxivId]: meta.arxivId,
    [FRONTMATTER_KEYS.doi]: meta.doi,
    [FRONTMATTER_KEYS.sourceUrl]: meta.sourceUrl,
    [FRONTMATTER_KEYS.pdfUrl]: meta.pdfUrl,
    [FRONTMATTER_KEYS.tags]: meta.tags,
    [FRONTMATTER_KEYS.addedAt]: meta.addedAt,
  }
}

export async function readPaper(dataDir: string, slug: string): Promise<Paper | null> {
  const file = paperFile(dataDir, slug, 'body')
  let text: string
  let mtimeMs: number
  try {
    const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    text = content
    mtimeMs = info.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const { meta, body } = splitDocument(text)
  return {
    meta: parsePaperMeta(meta, slug),
    body,
    mtimeMs,
    bodyHash: hashBody(body),
  }
}

export async function writePaper(dataDir: string, meta: PaperMeta, body: string): Promise<void> {
  const text = joinDocument({ meta: serializePaperMeta(meta), body })
  await writeAtomicFile(paperFile(dataDir, meta.slug, 'body'), text)
}

/**
 * 副次ファイル(和訳と abstract)を書く。
 *
 * 論文のメタデータは `paper.md` にだけ置き、ここには slug と言語だけを残す。
 * 同じ情報が複数のファイルにあると、片方だけ編集されたときにどちらが正か
 * 決められなくなる。
 */
export async function writePaperSideFile(
  dataDir: string,
  slug: string,
  kind: Exclude<PaperFileKind, 'body'>,
  body: string,
  lang: 'en' | 'ja',
): Promise<void> {
  const text = joinDocument({ meta: { slug, lang }, body })
  await writeAtomicFile(paperFile(dataDir, slug, kind), text)
}

export async function readPaperSideFile(
  dataDir: string,
  slug: string,
  kind: Exclude<PaperFileKind, 'body'>,
): Promise<string | null> {
  try {
    const text = await readFile(paperFile(dataDir, slug, kind), 'utf8')
    return splitDocument(text).body
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** `papers/` の直下にある、slug として扱えるディレクトリ名を列挙する。 */
export async function listPaperSlugs(dataDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(papersDir(dataDir), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory() && isValidSlug(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export async function deletePaperDir(dataDir: string, slug: string): Promise<void> {
  await rm(paperDir(dataDir, slug), { recursive: true, force: true })
}
