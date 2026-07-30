import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type ChatSearchHit, type ChatState, type ChatSummary } from '../api.ts'

export type ChatsPaneProps = {
  /** いま開いている会話。 */
  active: string | null
  /** null を渡すと、まだ作られていない新しい会話に切り替える。 */
  onOpen: (path: string | null) => void
  revision: number
  onChanged: () => void
}

const ICON = 14

/** 打っている間に毎打鍵で引かない。埋め込みの生成を伴うため(0005)。 */
const SEARCH_DELAY_MS = 300

/**
 * 一覧と検索結果に共通の行の中身。
 *
 * 検索した状態でもアーカイブと削除ができるように、どちらも同じ行として描く。
 */
type Row = {
  path: string
  title: string
  updated: string
  archived: boolean
  /** 一覧のときだけ付く。検索結果は当たった発言を出す。 */
  state: ChatState | null
  /** 当たった発言の役割。一覧では付かない。 */
  matched: ChatSearchHit['role']
  text: string
}

function day(at: string): string {
  return at.slice(0, 10)
}

function who(role: ChatSearchHit['role']): string {
  return role === 'user' ? '自分の発言' : 'エージェントの発言'
}

function fromSummary(chat: ChatSummary): Row {
  return {
    path: chat.path,
    title: chat.title,
    updated: chat.updated,
    archived: chat.archived,
    state: chat.state,
    matched: null,
    text: chat.summary,
  }
}

function fromHit(hit: ChatSearchHit): Row {
  return {
    path: hit.path,
    title: hit.title,
    updated: hit.updated,
    archived: hit.archived,
    state: null,
    matched: hit.role,
    text: hit.excerpt,
  }
}

export function ChatsPane({ active, onOpen, revision, onChanged }: ChatsPaneProps) {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null)

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

  useEffect(() => {
    const text = query.trim()
    if (text.length === 0) {
      setHits(null)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void api
        .searchChats(text)
        .then((r) => {
          if (live) setHits(r.hits)
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e))
        })
    }, SEARCH_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, revision])

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

  // 検索している間は、結果の側も引き直す。revision を上げると検索の効果が走る。
  const act = (run: Promise<unknown>): void => {
    void run
      .then(() => {
        load()
        onChanged()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const rows: Row[] = hits === null ? chats.map(fromSummary) : hits.map(fromHit)

  return (
    <div className="chats">
      <button type="button" className="chats__new" onClick={() => onOpen(null)}>
        <Plus size={ICON} aria-hidden /> 新しい会話
      </button>

      <div className="chats__search">
        <Search size={ICON} aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') setQuery('')
          }}
          placeholder="発言を検索"
          aria-label="会話を検索"
        />
        {query.length > 0 && (
          <button type="button" className="ghost" onClick={() => setQuery('')} aria-label="検索をやめる">
            <X size={ICON} aria-hidden />
          </button>
        )}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {rows.length === 0 && error === null && (
        <p className="empty">{hits === null ? '会話はまだありません' : '当たる会話がありません'}</p>
      )}

      {rows.map((row) => (
        <article
          key={row.path}
          className={`chat-row ${row.archived ? 'chat-row--archived' : ''} ${row.path === active ? 'chat-row--active' : ''}`}
        >
          <header>
            {editing === row.path ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => rename(row.path)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') rename(row.path)
                  if (e.key === 'Escape') setEditing(null)
                }}
                aria-label="会話のタイトル"
              />
            ) : (
              <button type="button" className="chat-row__title" onClick={() => onOpen(row.path)}>
                {row.title}
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setEditing(row.path)
                setDraft(row.title)
              }}
              title="タイトルを書き換える"
              aria-label="タイトルを書き換える"
            >
              <Pencil size={ICON} aria-hidden />
            </button>

            <div className="menu">
              <button
                type="button"
                className="ghost"
                aria-label="この会話の操作"
                onClick={() => setMenuOpen(menuOpen === row.path ? null : row.path)}
              >
                <MoreHorizontal size={ICON} aria-hidden />
              </button>
              {menuOpen === row.path && (
                <div className="menu-items" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(null)
                      act(api.setChatArchived(row.path, !row.archived))
                    }}
                  >
                    {row.archived ? (
                      <>
                        <ArchiveRestore size={ICON} aria-hidden /> アーカイブを解除
                      </>
                    ) : (
                      <>
                        <Archive size={ICON} aria-hidden /> アーカイブ
                      </>
                    )}
                  </button>
                  {/* 削除はここからだけ。確認を経てから実行する(0006)。 */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(null)
                      setConfirming(row.path)
                    }}
                  >
                    <Trash2 size={ICON} aria-hidden /> 削除
                  </button>
                </div>
              )}
            </div>
          </header>

          {confirming === row.path && (
            <p className="chat-row__confirm">
              この会話を消します。記録と実行状態の両方が無くなり、戻せません。
              <button
                type="button"
                onClick={() => {
                  setConfirming(null)
                  if (row.path === active) onOpen(null)
                  act(api.deleteChat(row.path))
                }}
              >
                消す
              </button>
              <button type="button" onClick={() => setConfirming(null)}>
                やめる
              </button>
            </p>
          )}

          <p className="chat-row__meta">
            {day(row.updated)}
            {row.matched !== null && <span className="chat-row__badge">{who(row.matched)}</span>}
            {row.archived && (
              <span className="chat-row__badge">
                <Archive size={ICON} aria-hidden /> アーカイブ済み
              </span>
            )}
            {row.state === 'needsReload' && (
              <span className="chat-row__badge chat-row__badge--warn">
                <RotateCcw size={ICON} aria-hidden /> 要再読み込み
              </span>
            )}
            {row.state === 'resumable' && (
              <span className="chat-row__badge">
                <Check size={ICON} aria-hidden /> 続けられる
              </span>
            )}
          </p>

          {row.text.length > 0 && <p className="chat-row__summary">{row.text}</p>}
        </article>
      ))}
    </div>
  )
}
