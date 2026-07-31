import { join } from 'node:path'
import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import { readChat, writeChat, type Chat, type ChatMessage } from '../data/chat.ts'
import { nowIsoDateTime } from '../data/datetime.ts'

const INSTRUCTIONS = `あなたは論文についての議論の記録に、一覧で見分けるためのタイトルと要約を付ける。

出力は次の形だけを返す。前置き・注釈・コードフェンスを付けない。

## タイトル

(1 行)

## 要約

(1 文から 3 文)

タイトルは 40 文字以内で、その議論を一覧の中で見分けられる語を選ぶ。句点で終えない。
「〜についての議論」のように、どの会話にも当てはまる言い方をしない。
要約は 200 文字以内で、何を論点にして何が分かったかを書く。
どちらも日本語で書く。論文の題や技術用語は原文のまま使ってよい。`

/** 直近のやりとりとして渡す発言の数。 */
const RECENT_MESSAGES = 4

/** 1 つの発言から渡す文字数。長い応答をそのまま入れると入力が伸び続ける。 */
const MESSAGE_LIMIT = 1500

/** タイトルの上限。frontmatter とファイル名に載るので、行が伸びない長さに抑える。 */
const TITLE_LIMIT = 40

const SUMMARY_LIMIT = 200

export type ChatDigestDeps = {
  dataDir: string
  codex: CodexClient
  model: string
  effort: string
  serviceTier: string | null
  /** 会話を索引へ載せ直す。一覧の題と要約が追随するのに要る。 */
  reindex: (absolutePath: string) => Promise<void>
}

export type Digest = {
  title: string | null
  summary: string | null
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…(以下省略)`
}

function speak(message: ChatMessage): string {
  const who = message.role === 'user' ? 'ユーザー' : 'エージェント'
  return `### ${who}\n\n${clip(message.text, MESSAGE_LIMIT)}`
}

/** 生成に渡す入力を組み立てる。渡すのは既存の要約と直近のやりとりだけである(0006)。 */
export function buildDigestInput(chat: Pick<Chat, 'meta' | 'messages'>): string {
  const recent = chat.messages.slice(-RECENT_MESSAGES)
  const parts = ['この議論のタイトルと要約を出せ。', '']

  if (chat.meta.summary.length > 0) {
    parts.push('## いまの要約', '', chat.meta.summary, '')
  }
  if (chat.meta.titleSource === 'user') {
    parts.push(
      '## タイトルについて',
      '',
      'タイトルはユーザーが付けたものを使うので、出力しなくてよい。要約だけを出せ。',
      '',
    )
  }

  parts.push('## 直近のやりとり', '', recent.map(speak).join('\n\n'))
  return parts.join('\n')
}

/** ファイル名に載っても壊れない 1 行にする(0002)。 */
function sanitizeTitle(text: string): string {
  const line = text
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[。.]+$/, '')
    .trim()
  return line.length <= TITLE_LIMIT ? line : line.slice(0, TITLE_LIMIT)
}

const SECTION = /^##+\s*(タイトル|要約)\s*$/

/**
 * 応答からタイトルと要約を取り出す。
 *
 * 見出しで区切られた 2 つの節だけを見て、それ以外の行は捨てる。指示に反して
 * 前置きが付いてきたときに、それを題や要約として拾わないためである。
 */
export function parseDigest(text: string): Digest {
  const found = new Map<string, string[]>()
  let current: string | null = null

  for (const line of text.replace(/```/g, '').split('\n')) {
    const heading = SECTION.exec(line.trim())
    if (heading !== null) {
      current = heading[1] as string
      found.set(current, [])
      continue
    }
    if (current !== null) found.get(current)?.push(line)
  }

  const title = (found.get('タイトル') ?? []).join(' ').trim()
  const summary = (found.get('要約') ?? []).join('\n').trim()

  return {
    title: title.length === 0 ? null : sanitizeTitle(title),
    summary: summary.length === 0 ? null : clip(summary.replace(/\n+/g, ' '), SUMMARY_LIMIT),
  }
}

/**
 * 会話のタイトルと要約を作り直す。
 *
 * ユーザーが付けたタイトルは上書きしない(0006)。会話が読めないときは何もしない。
 * 消された会話に対して待っていた生成が走ることがある。
 */
export async function digestChat(absolutePath: string, deps: ChatDigestDeps): Promise<Digest | null> {
  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null || chat.messages.length === 0) return null

  const threadId = await startWorkThread(deps.codex, {
    instructions: INSTRUCTIONS,
    model: deps.model,
    serviceTier: deps.serviceTier,
  })
  const outcome = await runTurn(deps.codex, {
    threadId,
    input: textInput(buildDigestInput(chat)),
    effort: deps.effort,
  })
  const digest = parseDigest(outcome.text)

  // 生成の間に届いた発言を落とさないよう、書き込みの直前に読み直す。
  const latest = (await readChat(deps.dataDir, absolutePath)) ?? chat
  const title = latest.meta.titleSource === 'user' ? latest.meta.title : digest.title ?? latest.meta.title
  const next: Chat = {
    ...latest,
    meta: {
      ...latest.meta,
      updated: nowIsoDateTime(),
      title,
      summary: digest.summary ?? latest.meta.summary,
    },
  }
  await writeChat(deps.dataDir, next)
  await deps.reindex(join(deps.dataDir, next.path))
  return digest
}
