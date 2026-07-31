import { dirname, join } from 'node:path'

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

/** 会話の本文のファイル名。ディレクトリが何の会話かを持つので、名前は固定にする。 */
export const CHAT_FILE = 'chat.md'

/**
 * 1 つの会話は 1 つのディレクトリに対応し、本文はその中の `chat.md` である(0013)。
 *
 * ディレクトリの名前は会話の識別子で、タイトルが変わっても動かない。論文が
 * `papers/<slug>/paper.md` を持つのと同じ形である。
 */
export function chatDir(dataDir: string, createdAt: Date, id: string): string {
  return join(chatDayDir(dataDir, createdAt), id)
}

export function chatFile(dataDir: string, createdAt: Date, id: string): string {
  return join(chatDir(dataDir, createdAt, id), CHAT_FILE)
}

/** 会話のディレクトリの中で、添付の実体を置く場所(0013)。 */
export const CHAT_ASSETS_DIR = 'assets'

export function chatAssetsDirOf(chatFilePath: string): string {
  return join(dirname(chatFilePath), CHAT_ASSETS_DIR)
}
