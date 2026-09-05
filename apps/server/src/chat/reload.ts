import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput } from '../codex/protocol.ts'
import { archiveThread, runTurn, startConversationThread } from '../codex/threads.ts'
import { readChat, withoutTurnIds, writeChat, type Chat } from '../data/chat.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { paperDir } from '../data/layout.ts'
import { attachmentPaths, referencedAttachments } from './attachments.ts'
import type { InstructionStore } from './instruction-store.ts'
import { chatInstructions } from './instructions.ts'
import { serializeMessages } from '../data/chat.ts'

export type ReloadDeps = {
  dataDir: string
  codex: CodexClient
  knownSlug: (slug: string) => boolean
  /** 議論中のエージェントが接続する MCP の口(0005)。 */
  mcpUrl: string
  /** ユーザーが決めた応答の仕方への指示(0014)。 */
  instructions: () => string
  /** スレッドに効いている指示の覚え(0014)。 */
  inForce: InstructionStore
}

/**
 * 読み込み直しの最初の入力を組み立てる。
 *
 * 論文の本文そのものは渡さない。全文を入れると文脈が埋まるので、場所だけを示す。
 */
export function buildReloadInput(chat: Chat, dataDir: string, knownSlug: (slug: string) => boolean): string {
  const papers = chat.meta.papers.filter(knownSlug)
  const parts = [
    'これまでの議論の続きを話す。以下はこの会話の記録の全文である。',
    '',
    '## 会話の記録',
    '',
    // turn の識別子は carrel が分岐に使う値で、議論の中身ではない。
    serializeMessages(withoutTurnIds(chat.messages)),
  ]
  if (papers.length > 0) {
    parts.push(
      '',
      '## この会話が参照している論文',
      '',
      ...papers.map((slug) => `- ${slug}(${paperDir(dataDir, slug)}/)`),
      '',
      '必要になったら読み直すこと。いま読む必要はない。',
    )
  }
  if (referencedAttachments(chat.messages).length > 0) {
    parts.push('', '記録の中の `assets/...` の画像は、この入力に添えてある。')
  }
  parts.push('', 'この記録を踏まえて、次の発言を待て。返答は要らない。')
  return parts.join('\n')
}

/**
 * 会話を新しいスレッドへ載せ直す。
 *
 * 会話ファイルは同じものを使い続け、本文には痕跡を残さない。読み込み直しで失う
 * のは中間状態だけで、記録から見れば議論は連続している。
 */
export async function reloadChat(absolutePath: string, deps: ReloadDeps): Promise<string> {
  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

  const instructions = deps.instructions()
  const threadId = await startConversationThread(deps.codex, {
    dataDir: deps.dataDir,
    model: chat.meta.model ?? '',
    mcpUrl: deps.mcpUrl,
    instructions: chatInstructions(instructions),
  })
  deps.inForce.remember(threadId, instructions)
  // 画像は文字で場所を示しても見えないので、実体を載せる(0013)。
  const images = await attachmentPaths(absolutePath, referencedAttachments(chat.messages))
  await runTurn(deps.codex, {
    threadId,
    input: imagesAndTextInput(images, buildReloadInput(chat, deps.dataDir, deps.knownSlug)),
  })
  await archiveThread(deps.codex, threadId)

  await writeChat(deps.dataDir, {
    path: chat.path,
    messages: withoutTurnIds(chat.messages),
    meta: { ...chat.meta, updated: nowIsoDateTime(), codexThreadId: threadId },
  })
  return threadId
}
