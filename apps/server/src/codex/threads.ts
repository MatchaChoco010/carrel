import type { CodexClient } from './client.ts'
import {
  isAgentMessageItem,
  isContextCompactionItem,
  MCP_SERVER_NAME,
  METHODS,
  NOTIFICATIONS,
  type AskForApproval,
  type Notification,
  type ThreadStartParams,
  type TurnStartParams,
} from './protocol.ts'

export type TurnOutcome = {
  threadId: string
  turnId: string | null
  status: string
  /** 最終的な応答の本文。`item/completed` から拾う。 */
  text: string
  /** このターンの途中で文脈が詰まり、古い発言が落ちたか(0014)。 */
  compacted: boolean
}

function readThreadId(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>
    if (typeof r['threadId'] === 'string') return r['threadId']
    const thread = r['thread']
    if (typeof thread === 'object' && thread !== null) {
      const id = (thread as Record<string, unknown>)['id']
      if (typeof id === 'string') return id
    }
  }
  throw new Error('thread/start が threadId を返さなかった')
}

/**
 * carrel の道具をスレッドへ宣言する設定(#313)。
 *
 * MCP の接続は app-server の生存に紐づくので、スレッドを立てるとき、読み込み直すとき、
 * 写して分けるときのすべてで渡す。渡さないと、そのスレッドは以後ずっと道具を持たない。
 */
export function mcpConfig(mcpUrl: string): NonNullable<ThreadStartParams['config']> {
  return { mcp_servers: { [MCP_SERVER_NAME]: { url: mcpUrl } } }
}

/** 議論に使うスレッド。コレクションを読め、モデルと effort は呼び出し側が選ぶ。 */
export async function startConversationThread(
  client: CodexClient,
  options: { dataDir: string; model: string; mcpUrl?: string; instructions?: string },
): Promise<string> {
  const params: ThreadStartParams = {
    cwd: options.dataDir,
    sandbox: 'read-only',
    model: options.model,
  }
  if (options.instructions !== undefined) params.baseInstructions = options.instructions
  if (options.mcpUrl !== undefined) params.config = mcpConfig(options.mcpUrl)
  return readThreadId(await client.request(METHODS.threadStart, params))
}

/**
 * 既存のスレッドを読み込み直す。残っていなければ false を返す。
 *
 * Codex の保存領域はマシンの入れ替えや掃除で失われる(0006)。また app-server を
 * 起動し直すとスレッドは記憶から降りるので、ターンを流す前に一度ここを通す。
 *
 * 道具の宣言は読み込み直しのたびに渡す(#277。→ `mcpConfig`)。
 */
export async function resumeThread(
  client: CodexClient,
  threadId: string,
  options: { mcpUrl?: string } = {},
): Promise<boolean> {
  try {
    const params: Record<string, unknown> = { threadId }
    if (options.mcpUrl !== undefined) params.config = mcpConfig(options.mcpUrl)
    await client.request(METHODS.threadResume, params)
    return true
  } catch {
    return false
  }
}

export type WorkThreadOptions = {
  instructions: string
  model: string
  cwd?: string
  approvalPolicy?: AskForApproval
  serviceTier?: string | null
  /** web を検索させる。既定では道具を渡さない。 */
  webSearch?: boolean
}

/**
 * 使い捨てのスレッドを立て、`run` が終わったら app-server から降ろす(#333)。
 *
 * 降ろさないと、スレッドは app-server に読み込まれたまま残り、Codex がスレッドごとに
 * 立てる MCP サーバーの子プロセスも生き続ける。仕事が失敗しても止められても降ろす。
 */
export async function withWorkThread<T>(
  client: CodexClient,
  options: WorkThreadOptions,
  run: (threadId: string) => Promise<T>,
): Promise<T> {
  const threadId = await startWorkThread(client, options)
  try {
    return await run(threadId)
  } finally {
    await dropThread(client, threadId)
  }
}

/**
 * スレッドを app-server から降ろす。rollout も一緒に消える。
 *
 * 降ろせなくても仕事の結果は変えない。app-server が落ちた後に来ることがあり、
 * そのときはスレッドも既に無い。
 */
async function dropThread(client: CodexClient, threadId: string): Promise<void> {
  try {
    await client.request(METHODS.threadDelete, { threadId })
  } catch (error) {
    console.warn(`スレッドを降ろせなかった(${threadId}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 1 つのジョブに対応する使い捨てのスレッド。指示と道具を最小にする。
 *
 * ephemeral にはしない。ephemeral なスレッドは `thread/delete` で降ろせない(#333)。
 */
async function startWorkThread(client: CodexClient, options: WorkThreadOptions): Promise<string> {
  const params: ThreadStartParams = {
    cwd: options.cwd ?? '/tmp',
    sandbox: 'read-only',
    model: options.model,
    baseInstructions: options.instructions,
  }
  if (options.webSearch === true) params.config = { tools: { web_search: {} } }
  if (options.approvalPolicy !== undefined) params.approvalPolicy = options.approvalPolicy
  if (options.serviceTier !== undefined && options.serviceTier !== null) params.serviceTier = options.serviceTier
  return readThreadId(await client.request(METHODS.threadStart, params))
}

/**
 * ターンを 1 つ流し、完了までの通知を集める。
 *
 * 最終的な本文は `turn/completed` ではなく `item/completed` に載る
 * (`turn/completed` の items は空で返るため)。
 */
/**
 * ターンが完了しなかったことを表す(#325)。
 *
 * 完了しなかった時点で、原因は Codex の側にある。容量不足も接続の切断もここに入る。
 * どの種類かは分けない。呼ぶ側が知りたいのは、その論文の問題ではないということだけである。
 */
export class TurnFailedError extends Error {
  constructor(detail: string | null) {
    const tail = detail === null ? '' : `(${detail})`
    super(`Codex がターンを完了できなかった。時間を置いてやり直すこと。${tail}`)
    this.name = 'TurnFailedError'
  }
}

/** 流し直す間隔(ミリ秒)。ここまで待って通らなければ諦め、ユーザーの手に返す。 */
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 480_000]

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * ターンを流す。完了しなかったら間隔を空けて流し直す(#325)。
 *
 * 失敗したターンは何も残さないので、同じスレッドへもう一度流してよい。待つのは失敗した
 * ターンだけで、他の仕事は止めない。容量不足は通るものと通らないものが混ざるためである。
 */
export async function runTurn(
  client: CodexClient,
  params: TurnStartParams,
  options: {
    onDelta?: (delta: string) => void
    onStarted?: (turnId: string) => void
    /** 流し直す間隔。試験で差し替える。 */
    retryDelaysMs?: number[]
  } = {},
): Promise<TurnOutcome> {
  const hooks = { onDelta: options.onDelta, onStarted: options.onStarted }
  for (const delay of options.retryDelaysMs ?? RETRY_DELAYS_MS) {
    try {
      return await runTurnOnce(client, params, hooks)
    } catch (error) {
      if (!(error instanceof TurnFailedError)) throw error
      console.warn(`${error.message} ${delay / 1000} 秒後に流し直す`)
      await wait(delay)
    }
  }
  return await runTurnOnce(client, params, hooks)
}

function runTurnOnce(
  client: CodexClient,
  params: TurnStartParams,
  hooks: { onDelta?: ((delta: string) => void) | undefined; onStarted?: ((turnId: string) => void) | undefined } = {},
): Promise<TurnOutcome> {
  return new Promise<TurnOutcome>((resolve, reject) => {
    let text = ''
    let turnId: string | null = null
    let compacted = false
    let off = (): void => {}

    const finish = (outcome: TurnOutcome): void => {
      off()
      resolve(outcome)
    }

    const onNotification = (notification: Notification): void => {
      const payload = (notification.params ?? {}) as Record<string, unknown>

      switch (notification.method) {
        case NOTIFICATIONS.turnStarted: {
          const turn = payload['turn']
          if (typeof turn === 'object' && turn !== null) {
            const id = (turn as Record<string, unknown>)['id']
            if (typeof id === 'string') {
              turnId = id
              hooks.onStarted?.(id)
            }
          }
          return
        }
        case NOTIFICATIONS.agentMessageDelta: {
          const delta = payload['delta']
          if (typeof delta === 'string') hooks.onDelta?.(delta)
          return
        }
        case NOTIFICATIONS.itemCompleted: {
          const item = payload['item']
          if (isAgentMessageItem(item) && item.phase === 'final_answer') text = item.text
          if (isContextCompactionItem(item)) compacted = true
          return
        }
        case NOTIFICATIONS.turnCompleted: {
          const turn = (payload['turn'] ?? {}) as Record<string, unknown>
          const status = typeof turn['status'] === 'string' ? turn['status'] : 'unknown'
          // 完了しなかったターンは本文を持たない。空の本文を返すと、受け取った側が
          // 応答の形が違うと誤って報告する(#325)。
          if (status !== 'completed') {
            off()
            const detail = (turn['error'] ?? null) as { message?: unknown } | null
            reject(new TurnFailedError(typeof detail?.message === 'string' ? detail.message : null))
            return
          }
          finish({ threadId: params.threadId, turnId, status, text, compacted })
          return
        }
        default:
          return
      }
    }

    off = client.onThread(params.threadId, { notify: onNotification, fail: reject })
    client.request(METHODS.turnStart, params).catch((error: unknown) => {
      off()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
