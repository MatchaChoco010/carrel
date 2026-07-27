import { join } from 'node:path'

export const PAPERS_DIR = 'papers'
export const CHATS_DIR = 'chats'

export type PaperFileKind = 'body' | 'bodyJa' | 'abstract' | 'abstractJa' | 'raw' | 'verification'

const PAPER_FILE_NAMES: Record<PaperFileKind, string> = {
  body: 'paper.md',
  bodyJa: 'paper.ja.md',
  abstract: 'abstract.md',
  abstractJa: 'abstract.ja.md',
  raw: 'paper.raw.md',
  verification: 'verification.md',
}

export function papersDir(dataDir: string): string {
  return join(dataDir, PAPERS_DIR)
}

export function chatsDir(dataDir: string): string {
  return join(dataDir, CHATS_DIR)
}

export function paperDir(dataDir: string, slug: string): string {
  return join(papersDir(dataDir), slug)
}

export function paperFile(dataDir: string, slug: string, kind: PaperFileKind): string {
  return join(paperDir(dataDir, slug), PAPER_FILE_NAMES[kind])
}

export function paperAssetsDir(dataDir: string, slug: string): string {
  return join(paperDir(dataDir, slug), 'assets')
}

export function paperPagesDir(dataDir: string, slug: string): string {
  return join(paperDir(dataDir, slug), 'pages')
}

export function paperOriginalPdf(dataDir: string, slug: string): string {
  return join(paperDir(dataDir, slug), 'original.pdf')
}

/** `chats/YYYY/MM/DD/` までを返す。 */
export function chatDayDir(dataDir: string, createdAt: Date): string {
  const year = String(createdAt.getFullYear()).padStart(4, '0')
  const month = String(createdAt.getMonth() + 1).padStart(2, '0')
  const day = String(createdAt.getDate()).padStart(2, '0')
  return join(chatsDir(dataDir), year, month, day)
}

function isPrintable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code >= 0x20 && code !== 0x7f
}

/**
 * ファイル名に使えない文字を落とす。
 *
 * タイトルはユーザーと AI の双方が決めるため、任意の文字列が来る。
 */
export function sanitizeTitleForFileName(title: string): string {
  const cleaned = [...title]
    .filter(isPrintable)
    .join('')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const limited = [...cleaned].slice(0, 60).join('')
  return limited.length > 0 ? limited : 'untitled'
}

export function chatFileName(createdAt: Date, title: string): string {
  const hh = String(createdAt.getHours()).padStart(2, '0')
  const mm = String(createdAt.getMinutes()).padStart(2, '0')
  const ss = String(createdAt.getSeconds()).padStart(2, '0')
  return `${hh}-${mm}-${ss}-${sanitizeTitleForFileName(title)}.md`
}
