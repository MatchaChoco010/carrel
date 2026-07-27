import type { CodexClient } from './client.ts'
import {
  isAgentMessageItem,
  METHODS,
  NOTIFICATIONS,
  type Notification,
  type ApprovalPolicy,
  type ThreadStartParams,
  type TurnStartParams,
  type UserInput,
} from './protocol.ts'

export type TurnOutcome = {
  threadId: string
  turnId: string | null
  status: string
  /** 最終的な応答の本文。`item/completed` から拾う。 */
  text: string
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
  options: { dataDir: string; model: string; mcpUrl?: string },
): Promise<string> {
  const params: ThreadStartParams = {
    cwd: options.dataDir,
    sandbox: 'read-only',
    model: options.model,
  }
  if (options.mcpUrl !== undefined) {
    params.config = { mcp_servers: { pct: { url: options.mcpUrl } } }
  }
  return readThreadId(await client.request(METHODS.threadStart, params))
}

/** 1 つのジョブに対応する使い捨てのスレッド。指示と道具を最小にする。 */
export async function startWorkThread(
  client: CodexClient,
  options: { instructions: string; model: string; cwd?: string; approvalPolicy?: ApprovalPolicy },
): Promise<string> {
  const params: ThreadStartParams = {
    ephemeral: true,
    cwd: options.cwd ?? '/tmp',
    sandbox: 'read-only',
    model: options.model,
    baseInstructions: options.instructions,
  }
  if (options.approvalPolicy !== undefined) params.approvalPolicy = options.approvalPolicy
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
  hooks: { onDelta?: (delta: string) => void } = {},
): Promise<TurnOutcome> {
  return new Promise<TurnOutcome>((resolve, reject) => {
    let text = ''
    let turnId: string | null = null

    const finish = (outcome: TurnOutcome): void => {
      client.off('notification', onNotification)
      resolve(outcome)
    }

    const onNotification = (notification: Notification): void => {
      const payload = (notification.params ?? {}) as Record<string, unknown>
      if (payload['threadId'] !== params.threadId) return

      switch (notification.method) {
        case NOTIFICATIONS.turnStarted: {
          const turn = payload['turn']
          if (typeof turn === 'object' && turn !== null) {
            const id = (turn as Record<string, unknown>)['id']
            if (typeof id === 'string') turnId = id
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
          return
        }
        case NOTIFICATIONS.turnCompleted: {
          const turn = (payload['turn'] ?? {}) as Record<string, unknown>
          finish({
            threadId: params.threadId,
            turnId,
            status: typeof turn['status'] === 'string' ? turn['status'] : 'unknown',
            text,
          })
          return
        }
        default:
          return
      }
    }

    client.on('notification', onNotification)
    client.request(METHODS.turnStart, params).catch((error: unknown) => {
      client.off('notification', onNotification)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export function textInput(text: string): UserInput[] {
  return [{ type: 'text', text }]
}
