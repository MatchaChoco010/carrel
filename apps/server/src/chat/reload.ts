import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startConversationThread } from '../codex/threads.ts'
import { readChat, writeChat, type Chat } from '../data/chat.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { paperDir } from '../data/layout.ts'
import { serializeMessages } from '../data/chat.ts'

export type ReloadDeps = {
  dataDir: string
  codex: CodexClient
  knownSlug: (slug: string) => boolean
}

/**
 * 読み込み直しの最初の入力を組み立てる。
 *
 * 渡すのは会話の全文と、参照論文の場所である。論文の本文そのものは渡さない。
 * 全文を入れると文脈が埋まるので、場所だけを示してエージェントに判断させる(0006)。
 */
export function buildReloadInput(chat: Chat, dataDir: string, knownSlug: (slug: string) => boolean): string {
  const papers = chat.meta.papers.filter(knownSlug)
  const parts = [
    'これまでの議論の続きを話す。以下はこの会話の記録の全文である。',
    '',
    '## 会話の記録',
    '',
    serializeMessages(chat.messages),
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
  parts.push('', 'この記録を踏まえて、次の発言を待て。返答は要らない。')
  return parts.join('\n')
}

/**
 * 会話を新しいスレッドへ載せ直す。
 *
 * 会話ファイルは同じものを使い続け、本文には痕跡を残さない。markdown から見れば
 * 議論は連続しているためである(0006)。
 */
export async function reloadChat(absolutePath: string, deps: ReloadDeps): Promise<string> {
  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

  const threadId = await startConversationThread(deps.codex, {
    dataDir: deps.dataDir,
    model: chat.meta.model ?? '',
  })
  await runTurn(deps.codex, {
    threadId,
    input: textInput(buildReloadInput(chat, deps.dataDir, deps.knownSlug)),
  })

  await writeChat(deps.dataDir, {
    path: chat.path,
    messages: chat.messages,
    meta: { ...chat.meta, updated: nowIsoDateTime(), codexThreadId: threadId },
  })
  return threadId
}
