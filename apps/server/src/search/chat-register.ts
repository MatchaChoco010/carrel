import { readChat, type Chat } from '../data/chat.ts'
import type { Embedder } from './embed.ts'
import type { ChatChunkInput, ChatChunkStore } from './chat-store.ts'

export type ChatIndexDeps = {
  dataDir: string
  chunks: ChatChunkStore
  embed: Embedder
}

/**
 * 発言をチャンクにする。
 *
 * 既にあるチャンクと本文が同じものはベクトルを使い回し、変わった発言と足された
 * 発言だけを埋め込みに回す(0006)。会話が伸びても、1 ターンの費用は一定に保たれる。
 */
export async function buildChatChunks(
  chat: Pick<Chat, 'messages'>,
  known: Map<string, Float32Array>,
  embed: Embedder,
): Promise<ChatChunkInput[]> {
  const messages = chat.messages.filter((m) => m.text.trim().length > 0)
  const missing = [...new Set(messages.map((m) => m.text).filter((text) => !known.has(text)))]
  const made = missing.length === 0 ? [] : await embed(missing)
  const vectors = new Map(known)
  missing.forEach((text, at) => {
    const vector = made[at]
    if (vector !== undefined) vectors.set(text, vector)
  })

  return messages.map((message, position) => ({
    position,
    role: message.role,
    at: message.at,
    text: message.text,
    vector: vectors.get(message.text) ?? null,
  }))
}

/** 会話 1 つを検索の索引へ載せる。会話が読めなければ何もしない。 */
export async function indexChatChunks(absolutePath: string, deps: ChatIndexDeps): Promise<number> {
  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null) return 0

  const known = new Map<string, Float32Array>()
  for (const chunk of deps.chunks.existing(chat.meta.id)) {
    if (chunk.vector !== null) known.set(chunk.text, chunk.vector)
  }

  const chunks = await buildChatChunks(chat, known, deps.embed)
  deps.chunks.replace(chat.meta.id, chunks)
  return chunks.length
}
