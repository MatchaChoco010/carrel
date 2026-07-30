import { join } from 'node:path'
import { chatPathFor, writeChat, type Chat } from '../data/chat.ts'
import { nowIsoDateTime, toIsoDateTime } from '../data/datetime.ts'

/** タイトルが決まるまでの仮の題。落ち着いたところで AI が付け直す(0006)。 */
const UNTITLED = '無題の会話'

export type CreateChatOptions = {
  model: string | null
  effort: string | null
  /** 最初から論文を指して始める場合の slug。 */
  papers?: string[]
}

/**
 * 会話のファイルを作る。
 *
 * Codex のスレッドはここでは立てず、最初の発言のときに立てる。作っただけで使わ
 * なかった会話に実行状態を残さないためである。
 */
export async function createChat(
  dataDir: string,
  options: CreateChatOptions,
  now: Date = new Date(),
): Promise<{ chat: Omit<Chat, 'mtimeMs'>; absolutePath: string }> {
  const at = toIsoDateTime(now)
  const path = chatPathFor(dataDir, now, UNTITLED)

  const chat: Omit<Chat, 'mtimeMs'> = {
    path,
    messages: [],
    meta: {
      id: path,
      created: at,
      updated: nowIsoDateTime(),
      title: UNTITLED,
      titleSource: 'auto',
      summary: '',
      archived: false,
      codexThreadId: null,
      model: options.model,
      effort: options.effort,
      papers: options.papers ?? [],
      forkedFrom: null,
    },
  }

  await writeChat(dataDir, chat)
  return { chat, absolutePath: join(dataDir, path) }
}
