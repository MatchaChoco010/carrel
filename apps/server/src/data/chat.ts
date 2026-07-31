import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { EPOCH_ISO_DATE_TIME, parseIsoDateTime, type IsoDateTime } from './datetime.ts'
import { joinDocument, splitDocument } from './frontmatter.ts'
import { chatFile, chatsDir } from './layout.ts'

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  at: IsoDateTime
  text: string
  /** その発言で完了した turn。分岐点として使う(0012)。応答にだけ付く。 */
  turnId?: string
}

export type ChatMeta = {
  id: string
  created: IsoDateTime
  updated: IsoDateTime
  title: string
  titleSource: 'auto' | 'user'
  summary: string
  archived: boolean
  codexThreadId: string | null
  model: string | null
  effort: string | null
  papers: string[]
  forkedFrom: string | null
}

export type Chat = {
  meta: ChatMeta
  messages: ChatMessage[]
  /** `$PCT_DATA` からの相対パス。 */
  path: string
  mtimeMs: number
}

const FRONTMATTER_KEYS = {
  id: 'id',
  created: 'created',
  updated: 'updated',
  title: 'title',
  titleSource: 'title_source',
  summary: 'summary',
  archived: 'archived',
  codexThreadId: 'codex_thread_id',
  model: 'model',
  effort: 'effort',
  papers: 'papers',
  forkedFrom: 'forked_from',
} as const

// 発言の区切り。役割と、日時として読める文字列の両方が揃った行だけを境界と
// みなすので、応答の本文に現れる見出しと取り違えない。
// 末尾の turn は分岐点を指す識別子で、無い見出しも妥当である(0012)。
const MESSAGE_HEADING = /^## (user|assistant) · (\S+)(?: · turn (\S+))?$/

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

export function parseChatMeta(raw: Record<string, unknown>, fallbackId: string): ChatMeta {
  const titleSource = raw[FRONTMATTER_KEYS.titleSource]
  return {
    id: asString(raw[FRONTMATTER_KEYS.id]) ?? fallbackId,
    created: parseIsoDateTime(raw[FRONTMATTER_KEYS.created]) ?? EPOCH_ISO_DATE_TIME,
    updated: parseIsoDateTime(raw[FRONTMATTER_KEYS.updated]) ?? EPOCH_ISO_DATE_TIME,
    title: asString(raw[FRONTMATTER_KEYS.title]) ?? 'untitled',
    titleSource: titleSource === 'user' ? 'user' : 'auto',
    summary: asString(raw[FRONTMATTER_KEYS.summary]) ?? '',
    archived: raw[FRONTMATTER_KEYS.archived] === true,
    codexThreadId: asString(raw[FRONTMATTER_KEYS.codexThreadId]),
    model: asString(raw[FRONTMATTER_KEYS.model]),
    effort: asString(raw[FRONTMATTER_KEYS.effort]),
    papers: asStringArray(raw[FRONTMATTER_KEYS.papers]),
    forkedFrom: asString(raw[FRONTMATTER_KEYS.forkedFrom]),
  }
}

export function serializeChatMeta(meta: ChatMeta): Record<string, unknown> {
  return {
    [FRONTMATTER_KEYS.id]: meta.id,
    [FRONTMATTER_KEYS.created]: meta.created,
    [FRONTMATTER_KEYS.updated]: meta.updated,
    [FRONTMATTER_KEYS.title]: meta.title,
    [FRONTMATTER_KEYS.titleSource]: meta.titleSource,
    [FRONTMATTER_KEYS.summary]: meta.summary,
    [FRONTMATTER_KEYS.archived]: meta.archived,
    [FRONTMATTER_KEYS.codexThreadId]: meta.codexThreadId,
    [FRONTMATTER_KEYS.model]: meta.model,
    [FRONTMATTER_KEYS.effort]: meta.effort,
    [FRONTMATTER_KEYS.papers]: meta.papers,
    [FRONTMATTER_KEYS.forkedFrom]: meta.forkedFrom,
  }
}

export function parseMessages(body: string): ChatMessage[] {
  const lines = body.split('\n')
  const messages: ChatMessage[] = []
  let current: { role: ChatRole; at: IsoDateTime; turnId: string | null; lines: string[] } | null = null

  const flush = (): void => {
    if (current === null) return
    const message: ChatMessage = { role: current.role, at: current.at, text: current.lines.join('\n').trim() }
    if (current.turnId !== null) message.turnId = current.turnId
    messages.push(message)
  }

  for (const line of lines) {
    const match = MESSAGE_HEADING.exec(line)
    const at = match === null ? null : parseIsoDateTime(match[2])
    if (match !== null && at !== null) {
      flush()
      current = { role: match[1] as ChatRole, at, turnId: match[3] ?? null, lines: [] }
      continue
    }
    if (current !== null) current.lines.push(line)
  }
  flush()

  return messages
}

export function serializeMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => `## ${m.role} · ${m.at}${m.turnId === undefined ? '' : ` · turn ${m.turnId}`}\n\n${m.text}\n`)
    .join('\n')
}

/**
 * 記録から turn の識別子を落とす。
 *
 * 読み込み直しで新しいスレッドへ移るときに使う。記録の識別子は常に
 * `codex_thread_id` のスレッドに属する、という約束を保つためである(0012)。
 */
export function withoutTurnIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ role, at, text }) => ({ role, at, text }))
}

export async function readChat(dataDir: string, absolutePath: string): Promise<Chat | null> {
  let text: string
  let mtimeMs: number
  try {
    const [content, info] = await Promise.all([readFile(absolutePath, 'utf8'), stat(absolutePath)])
    text = content
    mtimeMs = info.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const { meta, body } = splitDocument(text)
  const relativePath = relative(dataDir, absolutePath)
  return {
    meta: parseChatMeta(meta, relativePath),
    messages: parseMessages(body),
    path: relativePath,
    mtimeMs,
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${Date.now()}.${process.pid}.tmp`)
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

export async function writeChat(dataDir: string, chat: Omit<Chat, 'mtimeMs'>): Promise<string> {
  const absolutePath = join(dataDir, chat.path)
  const text = joinDocument({
    meta: serializeChatMeta(chat.meta),
    body: serializeMessages(chat.messages),
  })
  await writeAtomic(absolutePath, text)
  return absolutePath
}

/**
 * 会話の識別子を作る。
 *
 * 置き場所とタイトルから作らない。どちらも後から変わるので、参照に使う値が
 * それらを写していると、変わった後の値と食い違って読み手を惑わせる(0002)。
 * 作成の時刻を含めるのは、記録を追うときに `created` と突き合わせられるようにするため。
 */
export function newChatId(createdAt: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const stamp =
    `${pad(createdAt.getFullYear(), 4)}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}` +
    `T${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}${pad(createdAt.getSeconds())}`
  return `${stamp}-${randomUUID().slice(0, 6)}`
}

/**
 * 作成時刻と識別子から、その会話の本文を置くべき相対パスを決める(0013)。
 *
 * 識別子は作成のときに決まって変わらないので、この場所も会話の一生の間で動かない。
 */
export function chatPathFor(dataDir: string, createdAt: Date, id: string): string {
  return relative(dataDir, chatFile(dataDir, createdAt, id))
}

export async function listChatFiles(dataDir: string): Promise<string[]> {
  const root = chatsDir(dataDir)
  const found: string[] = []

  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
        found.push(full)
      }
    }
  }

  await walk(root)
  return found.sort()
}

export async function deleteChatFile(absolutePath: string): Promise<void> {
  await rm(absolutePath, { force: true })
}
