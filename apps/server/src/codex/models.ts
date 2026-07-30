import type { CodexClient } from './client.ts'
import { METHODS } from './protocol.ts'

export type CodexModel = {
  id: string
  displayName: string
  description: string
  efforts: string[]
  defaultEffort: string | null
  /** 画像を入力に取れるか。取り込みの照合はこれを要求する(0003)。 */
  acceptsImages: boolean
  isDefault: boolean
}

type Raw = {
  id?: unknown
  displayName?: unknown
  description?: unknown
  supportedReasoningEfforts?: unknown
  defaultReasoningEffort?: unknown
  inputModalities?: unknown
  hidden?: unknown
  isDefault?: unknown
}

function toModel(raw: Raw): CodexModel | null {
  if (typeof raw.id !== 'string') return null
  const efforts = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts
        .map((e) => (typeof e === 'object' && e !== null ? (e as { reasoningEffort?: unknown }).reasoningEffort : null))
        .filter((e): e is string => typeof e === 'string')
    : []
  const modalities = Array.isArray(raw.inputModalities)
    ? raw.inputModalities.filter((m): m is string => typeof m === 'string')
    : []

  return {
    id: raw.id,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : raw.id,
    description: typeof raw.description === 'string' ? raw.description : '',
    efforts,
    defaultEffort: typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort : null,
    acceptsImages: modalities.includes('image'),
    isDefault: raw.isDefault === true,
  }
}

/** 選べるモデルの一覧を引く。隠されているものは除く。 */
export async function listModels(client: CodexClient): Promise<CodexModel[]> {
  const result = (await client.request(METHODS.modelList, {})) as { data?: unknown }
  if (!Array.isArray(result.data)) return []
  return result.data
    .filter((raw): raw is Raw => typeof raw === 'object' && raw !== null && (raw as Raw).hidden !== true)
    .map(toModel)
    .filter((model): model is CodexModel => model !== null)
}
