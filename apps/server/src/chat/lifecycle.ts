import { rm } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import type { CodexClient } from '../codex/client.ts'
import { METHODS } from '../codex/protocol.ts'
import { readChat, writeChat } from '../data/chat.ts'
import { CHAT_FILE } from '../data/layout.ts'
import { nowIsoDateTime } from '../data/datetime.ts'

export type LifecycleDeps = {
  dataDir: string
  codex: CodexClient
  /** 索引から会話を外す。`$PCT_DATA` からの相対パスで指す。 */
  dropFromIndex: (path: string) => void
  /** 会話を索引へ載せ直す。 */
  reindex: (absolutePath: string) => Promise<void>
}

/**
 * アーカイブの状態を切り替える。
 *
 * pct 側の状態として frontmatter に持つ。Codex 側にも同名の操作があるが使わない。
 * ユーザーが整理するための概念であり、保存領域が失われても残る必要がある(0006)。
 */
export async function setArchived(absolutePath: string, archived: boolean, deps: LifecycleDeps): Promise<void> {
  const chat = await readChat(deps.dataDir, absolutePath)
  if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

  await writeChat(deps.dataDir, {
    path: chat.path,
    messages: chat.messages,
    meta: { ...chat.meta, updated: nowIsoDateTime(), archived },
  })
  await deps.reindex(absolutePath)
}

/**
 * 会話を消す。
 *
 * markdown と、対応する Codex のスレッドを破棄する。記録が無くなればそのスレッドを
 * 使う経路が無くなるので、残しても保存領域を占めるだけである(0006)。
 *
 * スレッドの破棄が失敗しても記録の削除は済ませる。ユーザーが消すと決めたものを
 * 残す理由はなく、残ったスレッドは参照されないままになる。
 *
 * 索引からはここで外す。ファイルの監視には任せない(#69)。
 */
export async function deleteChat(absolutePath: string, deps: LifecycleDeps): Promise<{ threadDeleted: boolean }> {
  const chat = await readChat(deps.dataDir, absolutePath)
  const threadId = chat?.meta.codexThreadId ?? null

  // 会話は 1 つのディレクトリなので、本文と添付をまとめて消す(0013)。日付の
  // ディレクトリに直に置かれた古い形の会話は、そのファイルだけを消す。
  const target = basename(absolutePath) === CHAT_FILE ? dirname(absolutePath) : absolutePath
  await rm(target, { recursive: true, force: true })
  deps.dropFromIndex(relative(deps.dataDir, absolutePath))

  if (threadId === null) return { threadDeleted: false }
  try {
    await deps.codex.request(METHODS.threadDelete, { threadId })
    return { threadDeleted: true }
  } catch {
    return { threadDeleted: false }
  }
}
