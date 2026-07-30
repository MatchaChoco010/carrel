import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexClient } from '../codex/client.ts'
import { METHODS, textInput } from '../codex/protocol.ts'
import { runTurn, startConversationThread } from '../codex/threads.ts'
import { chatPathFor, readChat, withoutTurnIds, writeChat, type Chat, type ChatMessage } from '../data/chat.ts'
import { nowIsoDateTime, toIsoDateTime } from '../data/datetime.ts'
import { buildReloadInput } from './reload.ts'

export type BranchDeps = {
  dataDir: string
  codex: CodexClient
  knownSlug: (slug: string) => boolean
  /** そのスレッドが Codex 側に残っているか。 */
  isResumable: (threadId: string | null) => Promise<boolean>
  /** 立てたスレッドを、生きているものとして覚えさせる。 */
  markResumed: (threadId: string) => void
  /** 呼び出しにも会話にもモデルの指定が無いときに使う値。 */
  defaults: () => { model: string; effort: string }
  reindex: (absolutePath: string) => Promise<void>
}

export type Branch = {
  /** 新しい会話の `$PCT_DATA` からの相対パス。 */
  path: string
  /** 中間状態を引き継いだかどうか。 */
  forked: boolean
}

/**
 * 引き継ぐ発言の範囲を決める。
 *
 * 分岐は turn の境界で行うので、選ばれた発言が属する turn の 1 つ前までを返す
 * (0012)。引き継ぐものが無いとき(会話の最初の turn を選んだとき)は null を返す。
 */
export function inherited(messages: ChatMessage[], selected: number): ChatMessage[] | null {
  if (selected < 0 || selected >= messages.length) return null

  // turn はユーザーの発言から始まる。応答を選んだときは、その turn の先頭まで戻る。
  let start = selected
  if (messages[selected]?.role === 'assistant') {
    while (start > 0 && messages[start - 1]?.role !== 'assistant') start -= 1
  }

  let end = -1
  for (let at = start - 1; at >= 0; at -= 1) {
    if (messages[at]?.role === 'assistant') {
      end = at
      break
    }
  }
  return end < 0 ? null : messages.slice(0, end + 1)
}

/** 引き継ぐ範囲の末尾の turn。ここまでを含めて分岐する。 */
function lastTurnId(messages: ChatMessage[]): string | null {
  return messages[messages.length - 1]?.turnId ?? null
}

/** 会話を分岐する。中間状態を引き継げないときは、記録から新しいスレッドを立てる(0012)。 */
export async function branchChat(absolutePath: string, selected: number, deps: BranchDeps): Promise<Branch> {
  const source = await readChat(deps.dataDir, absolutePath)
  if (source === null) throw new Error(`会話が読めない: ${absolutePath}`)

  const messages = inherited(source.messages, selected)
  if (messages === null) throw new Error('この発言より前に引き継ぐやりとりが無い')

  const turnId = lastTurnId(messages)
  const model = source.meta.model ?? deps.defaults().model
  const canFork = turnId !== null && (await deps.isResumable(source.meta.codexThreadId))

  const threadId = canFork
    ? await forkThread(deps.codex, source.meta.codexThreadId as string, turnId as string)
    : await primeThread(source, messages, model, deps)
  deps.markResumed(threadId)

  const now = new Date()
  const path = await freePath(deps.dataDir, now, source.meta.title)
  const next: Omit<Chat, 'mtimeMs'> = {
    path,
    // 立て直した経路では、写した発言の turn が新しいスレッドに無い(0012)。
    messages: canFork ? messages : withoutTurnIds(messages),
    meta: {
      ...source.meta,
      id: path,
      created: toIsoDateTime(now),
      updated: nowIsoDateTime(),
      archived: false,
      codexThreadId: threadId,
      model,
      forkedFrom: source.meta.id,
      // 分岐元の要約は引き継がない。ここに無い議論まで書かれているためである。
      summary: '',
      titleSource: 'auto',
    },
  }
  await writeChat(deps.dataDir, next)
  await deps.reindex(join(deps.dataDir, path))
  return { path, forked: canFork }
}

async function forkThread(codex: CodexClient, threadId: string, lastTurn: string): Promise<string> {
  const result = (await codex.request(METHODS.threadFork, { threadId, lastTurnId: lastTurn })) as {
    thread?: { id?: unknown }
  }
  const id = result.thread?.id
  if (typeof id !== 'string') throw new Error('thread/fork がスレッドを返さなかった')
  return id
}

/** 引き継ぐ範囲の記録で新しいスレッドを立てる。読み込み直しと同じ組み立てを使う。 */
async function primeThread(
  source: Chat,
  messages: ChatMessage[],
  model: string,
  deps: BranchDeps,
): Promise<string> {
  const threadId = await startConversationThread(deps.codex, { dataDir: deps.dataDir, model })
  await runTurn(deps.codex, {
    threadId,
    input: textInput(buildReloadInput({ ...source, messages }, deps.dataDir, deps.knownSlug)),
  })
  return threadId
}

/**
 * まだ使われていない置き場所を返す。
 *
 * 名前は秒までしか持たないので、同じ会話から続けて分岐すると衝突する。
 * そのまま書くと前の分岐を消してしまう。
 */
async function freePath(dataDir: string, now: Date, title: string): Promise<string> {
  for (let at = 1; at <= 100; at += 1) {
    const path = chatPathFor(dataDir, now, at === 1 ? title : `${title}-${at}`)
    if (!(await exists(join(dataDir, path)))) return path
  }
  throw new Error('分岐の置き場所が決まらない')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
