// app-server の線上の形。使う範囲だけを写している。
// 公式の定義との食い違いは protocol.conformance.test.ts が検出する。

export type RequestId = number

export type Request = {
  id: RequestId
  method: string
  params?: unknown
}

export type Response = {
  id: RequestId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type Notification = {
  method: string
  params?: unknown
}

export type ServerRequest = {
  id: RequestId
  method: string
  params?: unknown
}

export const METHODS = {
  initialize: 'initialize',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  threadFork: 'thread/fork',
  turnStart: 'turn/start',
  turnInterrupt: 'turn/interrupt',
  turnSteer: 'turn/steer',
  rateLimitsRead: 'account/rateLimits/read',
  modelList: 'model/list',
} as const

export const NOTIFICATIONS = {
  rateLimitsUpdated: 'account/rateLimits/updated',
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  agentMessageDelta: 'item/agentMessage/delta',
  reasoningTextDelta: 'item/reasoning/textDelta',
} as const

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never'

export type ThreadStartParams = {
  cwd?: string
  approvalPolicy?: ApprovalPolicy
  sandbox?: SandboxMode
  model?: string
  baseInstructions?: string
  developerInstructions?: string
  ephemeral?: boolean
  config?: Record<string, unknown>
}

export type UserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }

export type TurnStartParams = {
  threadId: string
  input: UserInput[]
  model?: string
  effort?: string
  outputSchema?: unknown
}

export type RateLimitWindow = {
  usedPercent: number
  resetsAt: number | null
  windowDurationMins: number | null
}

export type RateLimitSnapshot = {
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  planType: string | null
  rateLimitReachedType: string | null
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null
}

/**
 * 最終的な応答が載る item。
 *
 * `turn/completed` の `items` は空で `itemsView` が `notLoaded` になるため、
 * 応答本文はこの通知から拾う。
 */
export type AgentMessageItem = {
  type: 'agentMessage'
  id: string
  text: string
  phase: string | null
}

export function isAgentMessageItem(value: unknown): value is AgentMessageItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return item['type'] === 'agentMessage' && typeof item['text'] === 'string'
}

/** 承認を求めるサーバ要求かどうか。 */
export function isApprovalRequest(method: string): boolean {
  return method.includes('requestApproval') || method.endsWith('Approval')
}
