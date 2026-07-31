import { ArchiveRestore, GitBranch, ImagePlus, Loader2, RotateCcw, Send, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type ChatMessage, type ChatState, type CodexModel, type RateLimitView } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { SlugSuggest } from './SlugSuggest.tsx'

export type ChatPaneProps = {
  /** 一覧で選ばれた会話の識別子。null なら新しく始める案内を出す。 */
  id: string | null
  onOpen: (id: string | null) => void
  /** 制限に達していると送れない。回復時刻を出す(0003)。 */
  limits: RateLimitView | null
  /** 補完に使う slug の一覧。 */
  slugs: string[]
  /** ターンの進みの購読を親から受ける。 */
  subscribe: (handler: (event: { type: string; payload: unknown }) => void) => () => void
}

const ICON = 15

/**
 * 一度に描く発言の数。
 *
 * 会話が伸びると markdown の解析と数式のレイアウトが開くまでの時間を押し上げ、
 * DOM の要素数も比例して増える。
 */
const BATCH = 20

/** 描いていない範囲の下端がここまで近づいたら、古い発言を足す。 */
const NEAR_TOP = 400

/** 描いていない発言の高さの見積もり。 */
function estimateHeight(text: string): number {
  return 24 + Math.ceil(text.length / 90) * 22
}

type Turn = { id: string; delta: string }

/** 選んだ画像と、送るまでの間だけ使う見せかけの場所。 */
type Attachment = { file: File; preview: string }

export function ChatPane({ id, onOpen, limits, slugs, subscribe }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // いま出ている発言がどの会話のものか。場所が変わっても、届くまでは前の会話の
  // 発言が出ているので、末尾へ送る判断はこちらで行う。
  const [shown, setShown] = useState<string | null>(null)
  const [state, setState] = useState<ChatState>('new')
  const [reloading, setReloading] = useState(false)
  const [archived, setArchived] = useState(false)
  const [draft, setDraft] = useState('')
  /** 送る前の添付。実体は送信のときに初めてサーバーへ渡る(0013)。 */
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [model, setModel] = useState<string>('')
  const [effort, setEffort] = useState<string>('')
  /** 設定の既定。会話が自分の値を持たないときに使う。 */
  const [defaults, setDefaults] = useState<{ model: string; effort: string } | null>(null)
  /** Enter 系のキーで送るかどうか。設定で選ぶ。 */
  const [sendKeys, setSendKeys] = useState({ enter: false, ctrlEnter: false })
  /** 開いている会話が記録している値。まだ話していない会話は持たない。 */
  const [recorded, setRecorded] = useState<{ model: string | null; effort: string | null }>({
    model: null,
    effort: null,
  })
  const [turn, setTurn] = useState<Turn | null>(null)
  // 末尾から数えて描く発言の外にある、古い発言の数。
  const [hidden, setHidden] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  // 末尾へ送り終えた会話。開き直したときにもう一度送るための目印。
  const scrolledFor = useRef<string | null>(null)
  // 古い発言を足す直前の高さ。足した後に見ている場所を保つのに使う。
  const heightBeforeGrow = useRef<number | null>(null)
  const earlier = useRef<HTMLDivElement>(null)

  const blocked = limits?.reached === true

  useEffect(() => {
    void api
      .models()
      .then((r) => setModels(r.models))
      .catch(() => setModels([]))
  }, [])

  // 設定の既定を読み、設定が変わったら読み直す。
  useEffect(() => {
    const read = (): void => {
      void api
        .config()
        .then((c) => {
          setDefaults({ model: c.chat.defaultModel, effort: c.chat.defaultEffort })
          setSendKeys({ enter: c.chat.sendOnEnter, ctrlEnter: c.chat.sendOnCtrlEnter })
        })
        .catch(() => setDefaults(null))
    }
    read()
    return subscribe((event) => {
      if (event.type === 'config.changed') read()
    })
  }, [subscribe])

  /**
   * 選ぶ値を決める。
   *
   * 会話が記録している値が先で、無ければ設定の既定に従う。まだ話していない会話の
   * 選択は、設定を変えたときに追いかける。
   */
  useEffect(() => {
    if (defaults === null) return
    setModel(recorded.model ?? defaults.model)
    setEffort(recorded.effort ?? defaults.effort)
  }, [defaults, recorded])

  // 入力欄は会話を作った後に描かれるので、焦点は描かれてから移す。
  useEffect(() => {
    if (id !== null) input.current?.focus()
  }, [id])

  /**
   * 末尾へ送る。
   *
   * 会話を開いた直後は必ず送る。続きを話す相手は直近のやりとりである。発言が
   * 増えたときは末尾の近くにいるときだけ送り、過去を読んでいる途中で引き戻さない。
   *
   * 開いた直後かどうかは、いま出ている発言がどの会話のものかで判じる。場所が
   * 変わった時点ではまだ前の会話の発言が出ているので、そこを起点にすると、
   * 発言が届いたときには「もう送った」と見なされて末尾へ行かない。
   */
  useEffect(() => {
    const node = log.current
    if (node === null) return

    if (shown !== null && scrolledFor.current !== shown) {
      scrolledFor.current = shown
      // 数式のレイアウトとフォントの読み込みで高さが後から変わるので、次の描画でもう一度送る。
      node.scrollTop = node.scrollHeight
      requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight
      })
      return
    }

    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160
    if (nearBottom) node.scrollTop = node.scrollHeight
  }, [messages, turn, shown])

  const grow = useCallback(() => {
    const node = log.current
    if (node === null) return
    setHidden((previous) => {
      if (previous === 0) return previous
      heightBeforeGrow.current = node.scrollHeight
      return Math.max(0, previous - BATCH)
    })
  }, [])

  // 足した発言のぶんだけ上へ伸びるので、その差を足して見ている場所を保つ。
  useLayoutEffect(() => {
    const node = log.current
    const before = heightBeforeGrow.current
    if (node === null || before === null) return
    heightBeforeGrow.current = null
    node.scrollTop += node.scrollHeight - before
  }, [hidden])

  const efforts = useMemo(() => models.find((m) => m.id === model)?.efforts ?? [], [models, model])

  const load = useCallback((target: string) => {
    void api
      .chat(target)
      .then((r) => {
        setMessages(r.messages)
        setHidden(Math.max(0, r.messages.length - BATCH))
        setShown(r.id)
        setState(r.state)
        setArchived(r.meta.archived)
        setRecorded({ model: r.meta.model, effort: r.meta.effort })
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    // 新しい会話に切り替えたら、開いていた会話の表示を片付ける。
    if (id === null) {
      setMessages([])
      setHidden(0)
      setShown(null)
      setState('new')
      setTurn(null)
      setArchived(false)
      setRecorded({ model: null, effort: null })
      setError(null)
      return
    }
    load(id)
  }, [id, load])

  useEffect(
    () =>
      subscribe((event) => {
        const payload = event.payload as { id?: string; delta?: string; message?: string }
        if (id === null || payload.id !== id) return
        switch (event.type) {
          case 'chat.turn.started':
            setTurn({ id, delta: '' })
            return
          case 'chat.turn.delta':
            setTurn((previous) => ({ id, delta: (previous?.delta ?? '') + (payload.delta ?? '') }))
            return
          case 'chat.turn.completed':
            setTurn(null)
            load(id)
            return
          case 'chat.turn.failed':
            setTurn(null)
            setError(payload.message ?? '応答が返らなかった')
            load(id)
            return
          // アーカイブや題の書き換えは一覧からも起きる。
          case 'chat.changed':
            load(id)
            return
          case 'chat.removed':
            onOpen(null)
            return
          default:
            return
        }
      }),
    [subscribe, id, load, onOpen],
  )

  // 分岐したらその会話へ移る。分かれた先で続きを話すのが分岐の目的である(0006)。
  const branch = (index: number): void => {
    if (id === null) return
    void api
      .branchChat(id, index)
      .then((made) => onOpen(made.id))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const reload = (): void => {
    if (id === null) return
    setReloading(true)
    void api
      .reloadChat(id)
      .then(() => {
        setState('resumable')
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setReloading(false))
  }

  // 画像だけでも送れる。本文が空でも、画像があれば尋ねる形になる(0013)。
  const sendable =
    (draft.trim().length > 0 || attachments.length > 0) && !blocked && state !== 'needsReload' && !archived

  const attach = useCallback((files: Iterable<File>): void => {
    const images = [...files].filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return
    setAttachments((previous) => [
      ...previous,
      ...images.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ])
  }, [])

  // 貼り付けは入力欄の外で行われることもあるので、欄ではなく画面全体で拾う。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const files = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
      if (files.length > 0) attach(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [attach])

  const drop = (): void => {
    for (const attachment of attachments) URL.revokeObjectURL(attachment.preview)
    setAttachments([])
  }

  const remove = (at: number): void => {
    setAttachments((previous) => {
      const target = previous[at]
      if (target !== undefined) URL.revokeObjectURL(target.preview)
      return previous.filter((_, index) => index !== at)
    })
  }

  const send = (): void => {
    const text = draft.trim()
    if (!sendable) return
    const images = attachments.map((attachment) => attachment.file)
    setDraft('')
    drop()
    // 送った発言はターンの完了で読み直すまで手元で見せる。
    setMessages((previous) => [...previous, { role: 'user', at: new Date().toISOString(), text }])
    void api
      .sendChatMessage(id, text, model, effort, images)
      .then((r) => {
        // 初めての発言では、ここで会話の場所が決まる。
        if (id === null) onOpen(r.id)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="chat">
      <div
        className="chat__log"
        ref={log}
        onScroll={() => {
          // 上端で判じると、見積もりの高さぶんの空白を通り抜けるまで足されない。
          const edge = earlier.current?.getBoundingClientRect().bottom
          const top = log.current?.getBoundingClientRect().top
          if (hidden > 0 && edge !== undefined && top !== undefined && edge > top - NEAR_TOP) grow()
        }}
      >
        {id === null && messages.length === 0 && (
          <p className="chat__intro">論文について議論します。@ で論文を指して尋ねると、その論文を読んで答えます。</p>
        )}
        {hidden > 0 && (
          <div
            className="chat__earlier"
            ref={earlier}
            style={{ height: `${messages.slice(0, hidden).reduce((sum, m) => sum + estimateHeight(m.text), 0)}px` }}
          >
            <button type="button" onClick={grow}>
              前の {Math.min(BATCH, hidden)} 件を読み込む(残り {hidden} 件)
            </button>
          </div>
        )}
        {messages.slice(hidden).map((message, offset) => {
          const index = hidden + offset
          return (
          <article key={`${message.at}-${index}`} className={`turn turn--${message.role}`}>
            <Markdown text={message.text} chatId={shown ?? undefined} />
            {/* 最初の turn より後の発言から分岐できる(0012)。 */}
            {id !== null && index >= 2 && (
              <button
                type="button"
                className="turn__branch"
                onClick={() => branch(index)}
                title="ここから別の会話にする"
              >
                <GitBranch size={ICON} aria-hidden /> ここから分岐
              </button>
            )}
          </article>
          )
        })}
        {turn !== null && (
          <article className="turn turn--assistant">
            {turn.delta.length === 0 ? null : <Markdown text={turn.delta} chatId={shown ?? undefined} />}
            {/* 応答が伸びている間も、伸びが止まって見える間も、作っていることを示し続ける。 */}
            <p className="turn__working">
              <Loader2 size={ICON} className="spin" aria-hidden />
              応答を作っています
              <span className="turn__dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </p>
          </article>
        )}
      </div>

      {error !== null && <p className="error">{error}</p>}

      {archived && (
        <div className="chat__reload">
          <p>この会話はアーカイブしています。続けるにはアーカイブを解除してください。</p>
          <button
            type="button"
            onClick={() => {
              if (id === null) return
              void api
                .setChatArchived(id, false)
                .then(() => setArchived(false))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            }}
          >
            <ArchiveRestore size={ICON} aria-hidden /> 解除する
          </button>
        </div>
      )}

      {!archived && state === 'needsReload' && (
        <div className="chat__reload">
          <p>この会話の実行状態は残っていません。続けるには内容を読み込み直してください。</p>
          <button type="button" onClick={reload} disabled={reloading}>
            {reloading ? <Loader2 size={ICON} className="spin" aria-hidden /> : <RotateCcw size={ICON} aria-hidden />}
            読み込み直す
          </button>
        </div>
      )}

      <div
        className={dropping ? 'chat__compose chat__compose--dropping' : 'chat__compose'}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDropping(false)
          attach(event.dataTransfer.files)
        }}
      >
        {blocked && (
          <p className="status-item status-item--warn">
            利用制限に達しています。
            {limits?.nextResetAt !== null && limits?.nextResetAt !== undefined
              ? `${new Date(limits.nextResetAt * 1000).toLocaleString()} に解除されます。`
              : ''}
          </p>
        )}
        {attachments.length > 0 && (
          <ul className="chat__attachments">
            {attachments.map((attachment, at) => (
              <li key={attachment.preview}>
                <img src={attachment.preview} alt={attachment.file.name} />
                <button type="button" className="ghost" aria-label={`${attachment.file.name} を外す`} onClick={() => remove(at)}>
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SlugSuggest
          slugs={slugs}
          value={draft}
          onChange={setDraft}
          inputRef={input}
          sendOnEnter={sendKeys.enter}
          sendOnCtrlEnter={sendKeys.ctrlEnter}
          onSend={() => sendable && send()}
        />
        {/* 送るボタンを入力欄の次に置く。Escape のあと Tab を 1 回で届くようにする。
            見た目の並びは CSS の order で戻す。 */}
        <div className="chat__controls">
          <button type="button" onClick={send} disabled={!sendable}>
            <Send size={ICON} aria-hidden /> 送る
          </button>
          <button
            type="button"
            className="chat__attach"
            onClick={() => picker.current?.click()}
            aria-label="画像を添える"
            title="画像を添える"
          >
            <ImagePlus size={ICON} aria-hidden />
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => {
              attach(event.target.files ?? [])
              event.target.value = ''
            }}
          />
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="モデル">
            {/* 設定や会話が持つモデルが Codex の一覧に無いこともある。選択が消えないように出す。 */}
            {model.length > 0 && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} aria-label="reasoning effort">
            {effort.length > 0 && !efforts.includes(effort) && <option value={effort}>{effort}</option>}
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
