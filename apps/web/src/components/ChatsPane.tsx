import { Archive, Check, Pencil, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type ChatSummary } from '../api.ts'

export type ChatsPaneProps = {
  /** いま開いている会話。 */
  active: string | null
  /** null を渡すと、まだ作られていない新しい会話に切り替える。 */
  onOpen: (path: string | null) => void
  revision: number
  onChanged: () => void
}

const ICON = 14

function day(at: string): string {
  return at.slice(0, 10)
}

export function ChatsPane({ active, onOpen, revision, onChanged }: ChatsPaneProps) {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(() => {
    void api
      .chats()
      .then((r) => {
        setChats(r.chats)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(load, [load, revision])

  const rename = (path: string): void => {
    const title = draft.trim()
    setEditing(null)
    if (title.length === 0) return
    void api
      .renameChat(path, title)
      .then(() => {
        load()
        onChanged()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="chats">
      <button type="button" className="chats__new" onClick={() => onOpen(null)}>
        <Plus size={ICON} aria-hidden /> 新しい会話
      </button>

      {error !== null && <p className="error">{error}</p>}
      {chats.length === 0 && error === null && <p className="empty">会話はまだありません</p>}

      {chats.map((chat) => (
        <article
          key={chat.path}
          className={`chat-row ${chat.archived ? 'chat-row--archived' : ''} ${chat.path === active ? 'chat-row--active' : ''}`}
        >
          <header>
            {editing === chat.path ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => rename(chat.path)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') rename(chat.path)
                  if (e.key === 'Escape') setEditing(null)
                }}
                aria-label="会話のタイトル"
              />
            ) : (
              <button type="button" className="chat-row__title" onClick={() => onOpen(chat.path)}>
                {chat.title}
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setEditing(chat.path)
                setDraft(chat.title)
              }}
              title="タイトルを書き換える"
              aria-label="タイトルを書き換える"
            >
              <Pencil size={ICON} aria-hidden />
            </button>
          </header>

          <p className="chat-row__meta">
            {day(chat.updated)}
            {chat.archived && (
              <span className="chat-row__badge">
                <Archive size={ICON} aria-hidden /> アーカイブ済み
              </span>
            )}
            {chat.state === 'needsReload' && (
              <span className="chat-row__badge chat-row__badge--warn">
                <RotateCcw size={ICON} aria-hidden /> 要再読み込み
              </span>
            )}
            {chat.state === 'resumable' && (
              <span className="chat-row__badge">
                <Check size={ICON} aria-hidden /> 続けられる
              </span>
            )}
          </p>

          {chat.summary.length > 0 && <p className="chat-row__summary">{chat.summary}</p>}
        </article>
      ))}
    </div>
  )
}
