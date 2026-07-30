import type { ThreadStartParams } from './generated/v2/ThreadStartParams.ts'
import type { TurnStartParams } from './generated/v2/TurnStartParams.ts'
import type { UserInput } from './generated/v2/UserInput.ts'

export type { ThreadStartParams, TurnStartParams, UserInput }
export type { RateLimitWindow } from './generated/v2/RateLimitWindow.ts'
export type { AskForApproval } from './generated/v2/AskForApproval.ts'
export type { SandboxMode } from './generated/v2/SandboxMode.ts'
export type { ThreadItem } from './generated/v2/ThreadItem.ts'

export type RequestId = number

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
  threadDelete: 'thread/delete',
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
/** pct が立てる MCP のサーバーの名前。会話スレッドの設定に載る。 */
export const MCP_SERVER_NAME = 'pct'

/** MCP の道具を使ってよいかを訊いてくる要求。 */
export const METHODS_ELICITATION = 'mcpServer/elicitation/request'

export function isApprovalRequest(method: string): boolean {
  return method.includes('requestApproval') || method.endsWith('Approval')
}

export function textInput(text: string): UserInput[] {
  return [{ type: 'text', text, text_elements: [] }]
}

/** 手元のファイルの画像と本文を 1 つのターンの入力にする。 */
export function imagesAndTextInput(imagePaths: string[], text: string): UserInput[] {
  return [
    ...imagePaths.map((path): UserInput => ({ type: 'localImage', path })),
    { type: 'text', text, text_elements: [] },
  ]
}
