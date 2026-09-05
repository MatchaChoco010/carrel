import { join } from 'node:path'
import type { CodexClient } from '../codex/client.ts'
import { METHODS, imagesAndTextInput } from '../codex/protocol.ts'
import { archiveThread, mcpConfig, runTurn, startConversationThread, unarchiveThread } from '../codex/threads.ts'
import {
  chatPathFor,
  newChatId,
  readChat,
  withoutTurnIds,
  writeChat,
  type Chat,
  type ChatMessage,
} from '../data/chat.ts'
import { nowIsoDateTime, toIsoDateTime } from '../data/datetime.ts'
import { attachmentPaths, copyAttachments, referencedAttachments } from './attachments.ts'
import type { InstructionStore } from './instruction-store.ts'
import { chatInstructions } from './instructions.ts'
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
  /** 議論中のエージェントが接続する MCP の口(0005)。 */
  mcpUrl: string
  /** ユーザーが決めた応答の仕方への指示(0014)。 */
  instructions: () => string
  /** スレッドに効いている指示の覚え(0014)。 */
  inForce: InstructionStore
  reindex: (absolutePath: string) => Promise<void>
}

export type Branch = {
  /** 新しい会話の識別子。 */
  id: string
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
    ? await forkThread(deps.codex, source.meta.codexThreadId as string, turnId as string, deps.mcpUrl)
    : await primeThread(source, absolutePath, messages, model, deps)
  // 写したスレッドは元の指示をそのまま持つ(0014)。
  if (canFork) deps.inForce.copy(source.meta.codexThreadId as string, threadId)
  deps.markResumed(threadId)

  const now = new Date()
  const id = newChatId(now)
  const next: Omit<Chat, 'mtimeMs'> = {
    path: chatPathFor(deps.dataDir, now, id),
    // 立て直した経路では、写した発言の turn が新しいスレッドに無い(0012)。
    messages: canFork ? messages : withoutTurnIds(messages),
    meta: {
      ...source.meta,
      id,
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
  // 分岐先が単体で読める状態を保つ。参照は識別子を含まないので本文は書き替えない(0013)。
  await copyAttachments(absolutePath, join(deps.dataDir, next.path), referencedAttachments(messages))
  await deps.reindex(join(deps.dataDir, next.path))
  return { id: next.meta.id, forked: canFork }
}

/**
 * 指定した turn までを写した新しいスレッドを立てる(0012、0018)。
 *
 * 写した先は元のスレッドの MCP の接続を引き継がないので、道具の場所をここでも渡す(#313)。
 * 渡し忘れると写した会話は以後ずっと道具を持たないので、任意にせず必ず受け取る。
 */
export async function forkThread(
  codex: CodexClient,
  threadId: string,
  lastTurn: string,
  mcpUrl: string,
): Promise<string> {
  await unarchiveThread(codex, threadId)
  const result = (await codex.request(METHODS.threadFork, {
    threadId,
    lastTurnId: lastTurn,
    config: mcpConfig(mcpUrl),
  })) as {
    thread?: { id?: unknown }
  }
  const id = result.thread?.id
  if (typeof id !== 'string') throw new Error('thread/fork がスレッドを返さなかった')
  // fork した先は読み込まれた状態で返る(#335)。
  await archiveThread(codex, id)
  return id
}

/** 引き継ぐ範囲の記録で新しいスレッドを立てる。読み込み直しと同じ組み立てを使う。 */
async function primeThread(
  source: Chat,
  sourcePath: string,
  messages: ChatMessage[],
  model: string,
  deps: BranchDeps,
): Promise<string> {
  const instructions = deps.instructions()
  const threadId = await startConversationThread(deps.codex, {
    dataDir: deps.dataDir,
    model,
    mcpUrl: deps.mcpUrl,
    instructions: chatInstructions(instructions),
  })
  deps.inForce.remember(threadId, instructions)
  const images = await attachmentPaths(sourcePath, referencedAttachments(messages))
  await runTurn(deps.codex, {
    threadId,
    input: imagesAndTextInput(images, buildReloadInput({ ...source, messages }, deps.dataDir, deps.knownSlug)),
  })
  await archiveThread(deps.codex, threadId)
  return threadId
}

