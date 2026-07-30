import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startConversationThread } from '../codex/threads.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { readChat, writeChat, type Chat, type ChatMessage } from '../data/chat.ts'
import { expandMentions, findMentions } from './mentions.ts'

export type SessionDeps = {
  dataDir: string
  codex: CodexClient
  /** その slug の論文をコレクションが持っているか。 */
  knownSlug: (slug: string) => boolean
  /** ターンの進みを画面へ流す。 */
  onEvent: (event: ChatTurnEvent) => void
}

export type ChatTurnEvent =
  | { type: 'chat.turn.started'; path: string }
  | { type: 'chat.turn.delta'; path: string; delta: string }
  | { type: 'chat.turn.completed'; path: string; message: ChatMessage }
  | { type: 'chat.turn.failed'; path: string; message: string }

type Running = {
  /** ターン中に届いた入力。捨てずに溜め、そのターンの完了後にまとめて流す。 */
  queued: string[]
}

/** 会話 1 つぶんの実行を受け持つ。ターンが完了するたびに markdown へ追記する。 */
export class ChatSessions {
  readonly #deps: SessionDeps
  readonly #running = new Map<string, Running>()

  constructor(deps: SessionDeps) {
    this.#deps = deps
  }

  isRunning(path: string): boolean {
    return this.#running.has(path)
  }

  async send(absolutePath: string, text: string, options: { model?: string; effort?: string } = {}): Promise<void> {
    const running = this.#running.get(absolutePath)
    if (running !== undefined) {
      running.queued.push(text)
      return
    }

    this.#running.set(absolutePath, { queued: [] })
    try {
      await this.#runTurns(absolutePath, text, options)
    } finally {
      this.#running.delete(absolutePath)
    }
  }

  /** 溜まった入力が無くなるまでターンを続ける。 */
  async #runTurns(absolutePath: string, first: string, options: { model?: string; effort?: string }): Promise<void> {
    let pending: string | null = first
    while (pending !== null) {
      await this.#runTurn(absolutePath, pending, options)
      const queued = this.#running.get(absolutePath)?.queued ?? []
      pending = queued.length === 0 ? null : queued.splice(0, queued.length).join('\n\n')
    }
  }

  async #runTurn(absolutePath: string, text: string, options: { model?: string; effort?: string }): Promise<void> {
    const chat = await readChat(this.#deps.dataDir, absolutePath)
    if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

    const model = options.model ?? chat.meta.model
    const threadId = await this.#threadFor(chat, model)

    this.#deps.onEvent({ type: 'chat.turn.started', path: chat.path })
    const asked: ChatMessage = { role: 'user', at: nowIsoDateTime(), text }

    try {
      const outcome = await runTurn(
        this.#deps.codex,
        {
          threadId,
          input: textInput(expandMentions(text, this.#deps.dataDir, this.#deps.knownSlug)),
          ...(options.effort ?? chat.meta.effort ? { effort: (options.effort ?? chat.meta.effort) as never } : {}),
        },
        { onDelta: (delta) => this.#deps.onEvent({ type: 'chat.turn.delta', path: chat.path, delta }) },
      )

      const answered: ChatMessage = { role: 'assistant', at: nowIsoDateTime(), text: outcome.text }
      const saved = await this.#append(absolutePath, chat, [asked, answered], threadId, model, options.effort)
      this.#deps.onEvent({ type: 'chat.turn.completed', path: saved.path, message: answered })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 応答が返らなくても、ユーザーの発言は記録に残す。何を尋ねたかが失われると
      // 会話として読めなくなる。
      await this.#append(absolutePath, chat, [asked], threadId, model, options.effort)
      this.#deps.onEvent({ type: 'chat.turn.failed', path: chat.path, message })
      throw error
    }
  }

  /** 対応するスレッドを返す。無ければ新しく立てて frontmatter へ書き戻す。 */
  async #threadFor(chat: Chat, model: string | null): Promise<string> {
    if (chat.meta.codexThreadId !== null) return chat.meta.codexThreadId
    return startConversationThread(this.#deps.codex, {
      dataDir: this.#deps.dataDir,
      model: model ?? '',
    })
  }

  async #append(
    absolutePath: string,
    chat: Chat,
    added: ChatMessage[],
    threadId: string,
    model: string | null,
    effort: string | undefined,
  ): Promise<Chat> {
    // 追記の直前に読み直す。ターンの間に別の経路が書いていることがある。
    const latest = (await readChat(this.#deps.dataDir, absolutePath)) ?? chat
    const mentioned = added.flatMap((m) => findMentions(m.text)).filter(this.#deps.knownSlug)

    const next: Omit<Chat, 'mtimeMs'> = {
      path: latest.path,
      messages: [...latest.messages, ...added],
      meta: {
        ...latest.meta,
        updated: nowIsoDateTime(),
        codexThreadId: threadId,
        model,
        effort: effort ?? latest.meta.effort,
        papers: [...new Set([...latest.meta.papers, ...mentioned])],
      },
    }
    await writeChat(this.#deps.dataDir, next)
    return { ...next, mtimeMs: Date.now() }
  }
}
