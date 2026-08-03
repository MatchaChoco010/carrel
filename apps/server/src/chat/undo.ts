import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput } from '../codex/protocol.ts'
import { runTurn, startConversationThread } from '../codex/threads.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { readChat, withoutTurnIds, writeChat, type Chat, type ChatMessage } from '../data/chat.ts'
import { attachmentPaths, referencedAttachments } from './attachments.ts'
import { forkThread } from './branch.ts'
import type { InstructionStore } from './instruction-store.ts'
import { chatInstructions } from './instructions.ts'
import { buildReloadInput } from './reload.ts'

export type UndoDeps = {
  dataDir: string
  codex: CodexClient
  knownSlug: (slug: string) => boolean
  /** そのスレッドが Codex 側に残っているか。 */
  isResumable: (threadId: string | null) => Promise<boolean>
  /** 立てたスレッドを、生きているものとして覚えさせる。 */
  markResumed: (threadId: string) => void
  /** 走っているターンを止め、溜まった入力を捨てる。 */
  stop: (absolutePath: string) => Promise<void>
  defaults: () => { model: string; effort: string }
  mcpUrl: string
  instructions: () => string
  inForce: InstructionStore
  reindex: (absolutePath: string) => Promise<void>
}

/** 末尾のユーザーの発言の位置。無ければ -1。 */
export function lastAsked(messages: ChatMessage[]): number {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at]?.role === 'user') return at
  }
  return -1
}

/**
 * 直前のやりとりを取り消す(0018)。
 *
 * 記録の末尾にあるユーザーの発言と、それ以降を落とし、スレッドを 1 つ前の turn
 * まで巻き戻す。落とした発言の本文を返し、呼び出し側が入力欄へ戻す。
 */
export async function undoLastExchange(absolutePath: string, deps: UndoDeps): Promise<{ text: string }> {
  // 書いている途中の応答があれば止める。止めてから記録を読む。
  await deps.stop(absolutePath)

  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

  const at = lastAsked(chat.messages)
  if (at < 0) throw new Error('取り消せる発言が無い')

  const removed = chat.messages[at] as ChatMessage
  const remaining = chat.messages.slice(0, at)
  const rewound = await rewind(chat, absolutePath, remaining, deps)

  const next: Omit<Chat, 'mtimeMs'> = {
    path: chat.path,
    // 立て直した経路では、残した発言の turn が新しいスレッドに無い(0012)。
    messages: rewound.forked ? remaining : withoutTurnIds(remaining),
    meta: { ...chat.meta, codexThreadId: rewound.threadId, updated: nowIsoDateTime() },
  }
  await writeChat(deps.dataDir, next)
  await deps.reindex(absolutePath)

  return { text: removed.text }
}

/**
 * 残る記録に合わせたスレッドを返す。
 *
 * 残りの末尾の turn まで写す。写せないときは残る記録から立て直し(0012)、残るものが
 * 無ければスレッドを持たない状態に戻す。
 */
async function rewind(
  chat: Chat,
  absolutePath: string,
  remaining: ChatMessage[],
  deps: UndoDeps,
): Promise<{ threadId: string | null; forked: boolean }> {
  if (remaining.length === 0) return { threadId: null, forked: false }

  const source = chat.meta.codexThreadId
  const lastTurn = remaining[remaining.length - 1]?.turnId ?? null
  if (lastTurn !== null && source !== null && (await deps.isResumable(source))) {
    const forked = await forkThread(deps.codex, source, lastTurn, deps.mcpUrl)
    deps.inForce.copy(source, forked)
    deps.markResumed(forked)
    return { threadId: forked, forked: true }
  }

  const model = chat.meta.model ?? deps.defaults().model
  const instructions = deps.instructions()
  const threadId = await startConversationThread(deps.codex, {
    dataDir: deps.dataDir,
    model,
    mcpUrl: deps.mcpUrl,
    instructions: chatInstructions(instructions),
  })
  deps.inForce.remember(threadId, instructions)
  const images = await attachmentPaths(absolutePath, referencedAttachments(remaining))
  await runTurn(deps.codex, {
    threadId,
    input: imagesAndTextInput(images, buildReloadInput({ ...chat, messages: remaining }, deps.dataDir, deps.knownSlug)),
  })
  deps.markResumed(threadId)
  return { threadId, forked: false }
}
