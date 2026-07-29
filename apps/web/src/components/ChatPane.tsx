import { Loader2, Plus, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ChatMessage, type CodexModel, type RateLimitView } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { SlugSuggest } from './SlugSuggest.tsx'

export type ChatPaneProps = {
  /** 制限に達していると送れない。回復時刻を出す(0003)。 */
  limits: RateLimitView | null
  /** 補完に使う slug の一覧。 */
  slugs: string[]
  /** ターンの進みの購読を親から受ける。 */
  subscribe: (handler: (event: { type: string; payload: unknown }) => void) => () => void
}

const ICON = 15

type Turn = { path: string; delta: string }

export function ChatPane({ limits, slugs, subscribe }: ChatPaneProps) {
  const [path, setPath] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<CodexModel[]>([])
  const [model, setModel] = useState<string>('')
  const [effort, setEffort] = useState<string>('')
  const [turn, setTurn] = useState<Turn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const blocked = limits?.reached === true

  useEffect(() => {
    void api
      .models()
      .then((r) => {
        setModels(r.models)
        const preferred = r.models.find((m) => m.isDefault) ?? r.models[0]
        if (preferred !== undefined) {
          setModel(preferred.id)
          setEffort(preferred.defaultEffort ?? (preferred.efforts[0] ?? ''))
        }
      })
      .catch(() => setModels([]))
  }, [])

  // 入力欄は会話を作った後に描かれるので、焦点は描かれてから移す。
  useEffect(() => {
    if (path !== null) input.current?.focus()
  }, [path])

  const efforts = useMemo(() => models.find((m) => m.id === model)?.efforts ?? [], [models, model])

  const load = useCallback((target: string) => {
    void api
      .chat(target)
      .then((r) => {
        setMessages(r.messages)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(
    () =>
      subscribe((event) => {
        const payload = event.payload as { path?: string; delta?: string; message?: string }
        if (path === null || payload.path !== path) return
        switch (event.type) {
          case 'chat.turn.started':
            setTurn({ path, delta: '' })
            return
          case 'chat.turn.delta':
            setTurn((previous) => ({ path, delta: (previous?.delta ?? '') + (payload.delta ?? '') }))
            return
          case 'chat.turn.completed':
            setTurn(null)
            load(path)
            return
          case 'chat.turn.failed':
            setTurn(null)
            setError(payload.message ?? '応答が返らなかった')
            load(path)
            return
          default:
            return
        }
      }),
    [subscribe, path, load],
  )

  const start = (): void => {
    void api
      .createChat({ model, effort })
      .then((r) => {
        setPath(r.path)
        setMessages([])
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0 || path === null || blocked) return
    setDraft('')
    // 送った発言はターンの完了で読み直すまで手元で見せる。
    setMessages((previous) => [...previous, { role: 'user', at: new Date().toISOString(), text }])
    void api
      .sendChatMessage(path, text, model, effort)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  if (path === null) {
    return (
      <div className="chat chat--empty">
        <p className="pane__empty">論文について議論する会話を始めます。</p>
        <button type="button" onClick={start}>
          <Plus size={ICON} aria-hidden /> 会話を始める
        </button>
      </div>
    )
  }

  return (
    <div className="chat">
      <div className="chat__log">
        {messages.map((message, index) => (
          <article key={`${message.at}-${index}`} className={`turn turn--${message.role}`}>
            <Markdown text={message.text} />
          </article>
        ))}
        {turn !== null && (
          <article className="turn turn--assistant turn--running">
            {turn.delta.length === 0 ? (
              <p className="turn__waiting">
                <Loader2 size={ICON} className="spin" aria-hidden /> 考えています
              </p>
            ) : (
              <Markdown text={turn.delta} />
            )}
          </article>
        )}
      </div>

      {error !== null && <p className="error">{error}</p>}

      <div className="chat__compose">
        {blocked && (
          <p className="status-item status-item--warn">
            利用制限に達しています。
            {limits?.nextResetAt !== null && limits?.nextResetAt !== undefined
              ? `${new Date(limits.nextResetAt * 1000).toLocaleString()} に解除されます。`
              : ''}
          </p>
        )}
        <SlugSuggest slugs={slugs} value={draft} onChange={setDraft} inputRef={input} onSubmit={send} />
        <div className="chat__controls">
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="モデル">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} aria-label="reasoning effort">
            {efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button type="button" onClick={send} disabled={draft.trim().length === 0 || blocked}>
            <Send size={ICON} aria-hidden /> 送る
          </button>
        </div>
      </div>
    </div>
  )
}
