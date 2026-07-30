import { Loader2, RotateCcw, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ChatMessage, type ChatState, type CodexModel, type RateLimitView } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { SlugSuggest } from './SlugSuggest.tsx'

export type ChatPaneProps = {
  /** 一覧で選ばれた会話。null なら新しく始める案内を出す。 */
  path: string | null
  onOpen: (path: string | null) => void
  /** 制限に達していると送れない。回復時刻を出す(0003)。 */
  limits: RateLimitView | null
  /** 補完に使う slug の一覧。 */
  slugs: string[]
  /** ターンの進みの購読を親から受ける。 */
  subscribe: (handler: (event: { type: string; payload: unknown }) => void) => () => void
}

const ICON = 15

type Turn = { path: string; delta: string }

export function ChatPane({ path, onOpen, limits, slugs, subscribe }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [state, setState] = useState<ChatState>('new')
  const [reloading, setReloading] = useState(false)
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<CodexModel[]>([])
  const [model, setModel] = useState<string>('')
  const [effort, setEffort] = useState<string>('')
  const [turn, setTurn] = useState<Turn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)

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

  // 発言や応答が増えたら末尾へ送る。読んでいる途中で戻されないよう、末尾の近くに
  // いるときだけ動かす。
  useEffect(() => {
    const node = log.current
    if (node === null) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160
    if (nearBottom) node.scrollTop = node.scrollHeight
  }, [messages, turn])

  const efforts = useMemo(() => models.find((m) => m.id === model)?.efforts ?? [], [models, model])

  const load = useCallback((target: string) => {
    void api
      .chat(target)
      .then((r) => {
        setMessages(r.messages)
        setState(r.state)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    // 新しい会話に切り替えたら、開いていた会話の表示を片付ける。
    if (path === null) {
      setMessages([])
      setState('new')
      setTurn(null)
      setError(null)
      return
    }
    load(path)
  }, [path, load])

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

  const reload = (): void => {
    if (path === null) return
    setReloading(true)
    void api
      .reloadChat(path)
      .then(() => {
        setState('resumable')
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setReloading(false))
  }

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0 || blocked || state === 'needsReload') return
    setDraft('')
    // 送った発言はターンの完了で読み直すまで手元で見せる。
    setMessages((previous) => [...previous, { role: 'user', at: new Date().toISOString(), text }])
    void api
      .sendChatMessage(path, text, model, effort)
      .then((r) => {
        // 初めての発言では、ここで会話の場所が決まる。
        if (path === null) onOpen(r.path)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="chat">
      <div className="chat__log" ref={log}>
        {path === null && messages.length === 0 && (
          <p className="pane__empty">論文について議論します。@ で論文を指して尋ねると、その論文を読んで答えます。</p>
        )}
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

      {state === 'needsReload' && (
        <div className="chat__reload">
          <p>この会話の実行状態は残っていません。続けるには内容を読み込み直してください。</p>
          <button type="button" onClick={reload} disabled={reloading}>
            {reloading ? <Loader2 size={ICON} className="spin" aria-hidden /> : <RotateCcw size={ICON} aria-hidden />}
            読み込み直す
          </button>
        </div>
      )}

      <div className="chat__compose">
        {blocked && (
          <p className="status-item status-item--warn">
            利用制限に達しています。
            {limits?.nextResetAt !== null && limits?.nextResetAt !== undefined
              ? `${new Date(limits.nextResetAt * 1000).toLocaleString()} に解除されます。`
              : ''}
          </p>
        )}
        <SlugSuggest slugs={slugs} value={draft} onChange={setDraft} inputRef={input} />
        {/* 送るボタンを入力欄の次に置く。Escape のあと Tab を 1 回で届くようにする。
            見た目の並びは CSS の order で戻す。 */}
        <div className="chat__controls">
          <button
            type="button"
            onClick={send}
            disabled={draft.trim().length === 0 || blocked || state === 'needsReload'}
          >
            <Send size={ICON} aria-hidden /> 送る
          </button>
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
        </div>
      </div>
    </div>
  )
}
