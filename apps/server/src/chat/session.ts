import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput, METHODS } from '../codex/protocol.ts'
import {
  archiveThread,
  resumeThread,
  runTurn,
  startConversationThread,
  threadExists,
} from '../codex/threads.ts'
import { nowIsoDateTime } from '../data/datetime.ts'
import { readChat, writeChat, type Chat, type ChatMessage } from '../data/chat.ts'
import { storeImages, withAttachments, type IncomingImage } from './attachments.ts'
import { chatInstructions, fullInstructionNotice, instructionChangeNotice } from './instructions.ts'
import type { InstructionStore } from './instruction-store.ts'
import { expandMentions, findMentions } from './mentions.ts'

export type SessionDeps = {
  dataDir: string
  codex: CodexClient
  /** 会話のファイルを作る。最初の発言のときに呼ぶ。 */
  createChat: (options: { model: string | null; effort: string | null }) => Promise<{ absolutePath: string; id: string }>
  /** その slug の論文をコレクションが持っているか。 */
  knownSlug: (slug: string) => boolean
  /** 議論中のエージェントが接続する MCP の口(0005)。 */
  mcpUrl: string
  /**
   * 呼び出しにも会話にもモデルの指定が無いときに使う値。
   *
   * 設定は動いている間に書き換わるので、都度読む。
   */
  defaults: () => { model: string; effort: string }
  /** ユーザーが決めた応答の仕方への指示(0014)。 */
  instructions: () => string
  /** スレッドに効いている指示の覚え(0014)。 */
  inForce: InstructionStore
  /** ターンの進みを画面へ流す。 */
  onEvent: (event: ChatTurnEvent) => void
  /** 会話を索引へ載せ直す。一覧が追随するのに要る。 */
  reindex: (absolutePath: string) => Promise<void>
}

export type ChatTurnEvent =
  /**
   * 発言を受け取った(#240)。
   *
   * `waiting` が真なら、前の応答が終わるまで順番を待つ。応答を作り始めるのは
   * `chat.turn.started` からで、そこまでに数秒かかる。
   */
  | { type: 'chat.turn.queued'; id: string; waiting: boolean }
  | { type: 'chat.turn.started'; id: string }
  | { type: 'chat.turn.delta'; id: string; delta: string }
  | { type: 'chat.turn.completed'; id: string; message: ChatMessage }
  | { type: 'chat.turn.failed'; id: string; message: string }

/** 1 回の発言。本文と、それに添えた画像の実体の場所を持つ(0013)。 */
type Pending = {
  text: string
  imagePaths: string[]
}

type Running = {
  /** ターン中に届いた入力。捨てずに溜め、そのターンの完了後にまとめて流す。 */
  queued: Pending[]
  /**
   * いま書いている応答の、そこまでの本文(#262)。
   *
   * 差分は届いたそばから流すが、途中で会話を開き直した画面はそれ以前の差分を持たない。
   * 開き直したときに土台として渡せるよう、ここで繋いでおく。
   */
  text: string
  /** いま走っているターン。止めるときに要る(0018)。 */
  turn: { threadId: string; turnId: string } | null
  /** 取り消しで止めたかどうか。止めたターンの終わりは失敗として知らせない。 */
  interrupted: boolean
  /** 溜まった入力を含めて、すべてのターンが終わるまで。 */
  done: Promise<void>
}

/** 会話 1 つぶんの実行を受け持つ。ターンが完了するたびに markdown へ追記する。 */
/** 会話が続きを話せるかどうか。 */
export type ChatState = 'new' | 'resumable' | 'needsReload'

export class ChatSessions {
  readonly #deps: SessionDeps
  readonly #running = new Map<string, Running>()
  /**
   * スレッドが Codex 側に残っているか。一度調べた結果を覚える。
   *
   * 一覧を出すたびに会話の数だけ Codex に訊くことになるので、結果を持ち回す。
   * 失われたスレッドが後から戻ることは無いので、否定の結果も覚えてよい。
   * 読み込み直しをしたときだけ書き換わる。
   */
  readonly #alive = new Map<string, boolean>()
  /** いま調べている最中のスレッド。同じものを二重に調べないために持つ(#327)。 */
  readonly #resolving = new Set<string>()

  constructor(deps: SessionDeps) {
    this.#deps = deps
  }

  isRunning(path: string): boolean {
    return this.#running.has(path)
  }

  /**
   * いま書いている応答の、そこまでの本文(#262)。
   *
   * 走っていなければ null。会話を開き直した画面が、続きの差分を足す土台にする。
   */
  partialAnswer(path: string): string | null {
    return this.#running.get(path)?.text ?? null
  }

  /**
   * その会話が続きを話せるかを調べる。
   *
   * スレッドを持たない会話は `new` で、最初の発言のときに立てる。持っているのに
   * Codex 側に無いものは `needsReload` とし、読み込み直しはユーザーが実行する(0006)。
   */
  async state(chat: Chat): Promise<ChatState> {
    const threadId = chat.meta.codexThreadId
    if (threadId === null) return 'new'
    return (await this.#isAlive(threadId)) ? 'resumable' : 'needsReload'
  }

  async stateOfThread(threadId: string | null): Promise<ChatState> {
    if (threadId === null) return 'new'
    return (await this.#isAlive(threadId)) ? 'resumable' : 'needsReload'
  }

  /**
   * 既に調べ終えている状態だけを返す。まだなら null(#327)。
   *
   * 一覧はこれで即座に返し、まだ分からないものは {@link resolveStates} に任せる。
   */
  knownStateOfThread(threadId: string | null): ChatState | null {
    if (threadId === null) return 'new'
    const known = this.#alive.get(threadId)
    if (known === undefined) return null
    return known ? 'resumable' : 'needsReload'
  }

  /**
   * まだ調べていないスレッドを、一覧を返した後で調べる(#327)。
   *
   * 分かったものから `onResolved` で知らせる。この呼び出しは待たずに返る。
   * 同じスレッドを二重に調べないよう、調べている間は覚えておく。
   */
  resolveStates(threadIds: (string | null)[], onResolved: (threadId: string, state: ChatState) => void): void {
    for (const threadId of threadIds) {
      if (threadId === null || this.#alive.has(threadId) || this.#resolving.has(threadId)) continue
      this.#resolving.add(threadId)
      void this.#isAlive(threadId)
        .then((alive) => onResolved(threadId, alive ? 'resumable' : 'needsReload'))
        .catch(() => undefined)
        .finally(() => this.#resolving.delete(threadId))
    }
  }

  markResumed(threadId: string): void {
    this.#alive.set(threadId, true)
  }

  async #isAlive(threadId: string): Promise<boolean> {
    const known = this.#alive.get(threadId)
    if (known !== undefined) return known
    const alive = await threadExists(this.#deps.codex, threadId)
    this.#alive.set(threadId, alive)
    return alive
  }

  /**
   * 発言を送り、その会話の場所を返す。
   *
   * 場所を渡さなければ、この発言で会話を作る。ファイルを先に作らないのは、始めた
   * だけで話さなかった会話を記録に残さないためである。
   *
   * 返るのは場所が決まった時点で、応答は待たない。ターンの進みは通知で流す。
   */
  async send(
    path: string | null,
    text: string,
    options: { model?: string; effort?: string; images?: IncomingImage[] } = {},
  ): Promise<{ path: string; id: string }> {
    const created =
      path === null
        ? await this.#deps.createChat({ model: options.model ?? null, effort: options.effort ?? null })
        : null
    const absolutePath = created?.absolutePath ?? (path as string)
    const id = created?.id ?? (await readChat(this.#deps.dataDir, absolutePath))?.meta.id ?? absolutePath

    const stored = await storeImages(absolutePath, options.images ?? [])
    const pending: Pending = {
      text: withAttachments(text, stored),
      imagePaths: stored.map((image) => image.file),
    }

    const current = this.#running.get(absolutePath)
    this.#deps.onEvent({ type: 'chat.turn.queued', id, waiting: current !== undefined })
    if (current !== undefined) {
      current.queued.push(pending)
      return { path: absolutePath, id }
    }

    const running: Running = { queued: [], turn: null, interrupted: false, text: '', done: Promise.resolve() }
    this.#running.set(absolutePath, running)
    running.done = this.#runTurns(absolutePath, pending, options)
      .catch(() => {
        // 失敗は #runTurn が通知で流している。ここで握るのは、待たない呼びから
        // 例外が漏れないようにするためである。
      })
      .finally(() => this.#running.delete(absolutePath))

    return { path: absolutePath, id }
  }

  /** 溜まった入力が無くなるまでターンを続ける。 */
  async #runTurns(absolutePath: string, first: Pending, options: { model?: string; effort?: string }): Promise<void> {
    let pending: Pending | null = first
    while (pending !== null) {
      await this.#runTurn(absolutePath, pending, options)
      const queued = this.#running.get(absolutePath)?.queued ?? []
      if (queued.length === 0) {
        pending = null
        continue
      }
      const taken = queued.splice(0, queued.length)
      pending = {
        text: taken.map((item) => item.text).join('\n\n'),
        imagePaths: taken.flatMap((item) => item.imagePaths),
      }
    }
  }

  async #runTurn(absolutePath: string, pending: Pending, options: { model?: string; effort?: string }): Promise<void> {
    const chat = await readChat(this.#deps.dataDir, absolutePath)
    if (chat === null) throw new Error(`会話が読めない: ${absolutePath}`)

    const defaults = this.#deps.defaults()
    const model = options.model ?? chat.meta.model ?? defaults.model
    const effort = options.effort ?? chat.meta.effort ?? defaults.effort
    const threadId = await this.#threadFor(chat, model)

    // ユーザーの発言は応答を待たずに記録する。待ってから書くと、応答が返るまでの
    // 間にファイルを読んだ画面から発言が消える。
    const asked: ChatMessage = { role: 'user', at: nowIsoDateTime(), text: pending.text }
    const withAsked = await this.#append(absolutePath, chat, [asked], threadId, model, effort)
    const running = this.#running.get(absolutePath)
    if (running !== undefined) running.text = ''
    this.#deps.onEvent({ type: 'chat.turn.started', id: chat.meta.id })

    try {
      // 設定の指示が変わっていたら、この発言の前に差し込む(0014)。記録には残さない。
      // 覚えの無いスレッドは carrel の指示を持たないことがあるので、そのときは全体を載せる。
      const instructions = this.#deps.instructions()
      const known = this.#deps.inForce.inForce(threadId)
      const changed = known !== instructions
      const notice = !changed
        ? ''
        : known === null
          ? fullInstructionNotice(instructions)
          : instructionChangeNotice(instructions)

      const outcome = await runTurn(
        this.#deps.codex,
        {
          threadId,
          input: imagesAndTextInput(
            pending.imagePaths,
            notice + expandMentions(pending.text, this.#deps.dataDir, this.#deps.knownSlug),
          ),
          effort,
        },
        {
          onDelta: (delta) => {
            if (running !== undefined) running.text += delta
            this.#deps.onEvent({ type: 'chat.turn.delta', id: chat.meta.id, delta })
          },
          onStarted: (turnId) => {
            if (running !== undefined) running.turn = { threadId, turnId }
          },
        },
      )
      if (running !== undefined) {
        running.turn = null
        running.text = ''
      }

      // 差し込みは会話の一部なので、コンパクションで落ちうる。落ちたら覚えを捨て、
      // 次の発言で差し込み直す(0014)。
      if (outcome.compacted) this.#deps.inForce.forget(threadId)
      else if (changed) this.#deps.inForce.remember(threadId, instructions)

      // 応答が無いまま終わったターンは失敗として扱う。空の発言を残すと、記録の上で
      // 「何も返らなかった」と「ターンが途中で終わった」を区別できなくなる。
      if (outcome.status !== 'completed' || outcome.text.trim().length === 0) {
        throw new Error(`応答が返らなかった (status=${outcome.status})`)
      }

      const answered: ChatMessage = { role: 'assistant', at: nowIsoDateTime(), text: outcome.text }
      // 完了した turn だけが分岐点になれる(0012)。
      if (outcome.turnId !== null) answered.turnId = outcome.turnId
      const saved = await this.#append(absolutePath, withAsked, [answered], threadId, model, effort)
      this.#deps.onEvent({ type: 'chat.turn.completed', id: saved.meta.id, message: answered })
    } catch (error) {
      if (running !== undefined) {
        running.turn = null
        running.text = ''
      }
      // 取り消しで止めたターンは、失敗として知らせない。記録も直後に巻き戻る。
      if (running?.interrupted === true) return
      const message = error instanceof Error ? error.message : String(error)
      this.#deps.onEvent({ type: 'chat.turn.failed', id: chat.meta.id, message })
      throw error
    } finally {
      // 次の発言まで載せておく理由が無い。載せたままだと会話の数だけ MCP が立つ(#335)。
      await archiveThread(this.#deps.codex, threadId)
    }
  }

  /**
   * 走っているターンを止め、溜まった入力を捨てる(0018)。
   *
   * 止めた後は、そのターンが終わるまで待つ。記録を巻き戻す側が、書き込みの
   * 途中の記録を読まないようにするためである。
   */
  async stop(path: string): Promise<void> {
    const running = this.#running.get(path)
    if (running === undefined) return
    running.interrupted = true
    running.queued.length = 0
    if (running.turn !== null) {
      await this.#deps.codex.request(METHODS.turnInterrupt, running.turn).catch(() => {})
    }
    await running.done
  }

  /**
   * 対応するスレッドを app-server に載せて返す。無ければ新しく立てる。
   *
   * 会話のスレッドはターンの合間は降ろしてあるので(#335)、ターンを流す前に載せる。
   * 降りたままターンを始めても届かない。
   */
  async #threadFor(chat: Chat, model: string): Promise<string> {
    const existing = chat.meta.codexThreadId
    if (existing !== null) {
      if (!(await this.#isAlive(existing))) throw new Error('この会話の実行状態は残っていない。読み込み直しが要る')
      if (!(await resumeThread(this.#deps.codex, existing, { mcpUrl: this.#deps.mcpUrl }))) {
        throw new Error('この会話のスレッドを app-server に載せられなかった')
      }
      return existing
    }
    // 空のモデルでもスレッドは立つが、ターンは何も返さずに終わる。
    if (model.length === 0) throw new Error('モデルが決まっていない。設定の chat.defaultModel を確かめること')
    const instructions = this.#deps.instructions()
    const created = await startConversationThread(this.#deps.codex, {
      dataDir: this.#deps.dataDir,
      model,
      mcpUrl: this.#deps.mcpUrl,
      instructions: chatInstructions(instructions),
    })
    this.#deps.inForce.remember(created, instructions)
    this.#alive.set(created, true)
    return created
  }

  async #append(
    absolutePath: string,
    chat: Chat,
    added: ChatMessage[],
    threadId: string,
    model: string,
    effort: string,
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
        effort,
        papers: [...new Set([...latest.meta.papers, ...mentioned])],
      },
    }
    await writeChat(this.#deps.dataDir, next)
    await this.#deps.reindex(absolutePath)
    return { ...next, mtimeMs: Date.now() }
  }
}
