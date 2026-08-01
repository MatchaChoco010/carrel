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
  if (options.mcpUrl !== undefined) {
    params.config = { mcp_servers: { [MCP_SERVER_NAME]: { url: options.mcpUrl } } }
  }
  return readThreadId(await client.request(METHODS.threadStart, params))
}

/**
 * 既存のスレッドを読み込み直す。残っていなければ false を返す。
 *
 * Codex の保存領域はマシンの入れ替えや掃除で失われる(0006)。また app-server を
 * 起動し直すとスレッドは記憶から降りるので、ターンを流す前に一度ここを通す。
 *
 * **道具の宣言は読み込み直しのたびに渡す(#277)。** スレッドの中身は Codex 側に
 * 残るが、MCP の接続は app-server の生存に紐づく。渡さないと、読み込み直した会話は
 * 以後ずっと pct の道具を持たない。
 */
export async function resumeThread(
  client: CodexClient,
  threadId: string,
  options: { mcpUrl?: string } = {},
): Promise<boolean> {
  try {
    const params: Record<string, unknown> = { threadId }
    if (options.mcpUrl !== undefined) {
      params.config = { mcp_servers: { [MCP_SERVER_NAME]: { url: options.mcpUrl } } }
    }
    await client.request(METHODS.threadResume, params)
    return true
  } catch {
    return false
  }
}

/** 1 つのジョブに対応する使い捨てのスレッド。指示と道具を最小にする。 */
export async function startWorkThread(
  client: CodexClient,
  options: {
    instructions: string
    model: string
    cwd?: string
    approvalPolicy?: AskForApproval
    serviceTier?: string | null
    /** web を検索させる。既定では道具を渡さない。 */
    webSearch?: boolean
  },
): Promise<string> {
  const params: ThreadStartParams = {
    ephemeral: true,
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
export function runTurn(
  client: CodexClient,
  params: TurnStartParams,
  hooks: { onDelta?: (delta: string) => void; onStarted?: (turnId: string) => void } = {},
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
          finish({
            threadId: params.threadId,
            turnId,
            status: typeof turn['status'] === 'string' ? turn['status'] : 'unknown',
            text,
            compacted,
          })
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
