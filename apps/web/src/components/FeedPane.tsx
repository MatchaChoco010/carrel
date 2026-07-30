import { Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FeedItem } from '../api.ts'
import type { Lang } from '../useLang.ts'

export type FeedPaneProps = {
  lang: Lang
  onLangChange: (lang: Lang) => void
  revision: number
  /** 未読数を伝える。アイコンのバッジがこれを出す。 */
  onUnread: (count: number) => void
  onChanged: () => void
}

const ICON = 15

function day(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function FeedPane({ lang, onLangChange, revision, onUnread, onChanged }: FeedPaneProps) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  // 既読にした識別子。同じ項目を何度も既読にしにいかないため。
  const marked = useRef(new Set<string>())

  const load = useCallback(() => {
    void api
      .feed()
      .then((r) => {
        setItems(r.items)
        onUnread(r.unread)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [onUnread])

  useEffect(load, [load, revision])

  // 画面に出た時点で既読にする(0004)。
  useEffect(() => {
    const unread = items.filter((i) => !i.read && !marked.current.has(i.arxivId)).map((i) => i.arxivId)
    if (unread.length === 0) return
    for (const id of unread) marked.current.add(id)
    void api.markFeedRead(unread).then((r) => onUnread(r.unread))
  }, [items, onUnread])

  const refresh = (): void => {
    setRefreshing(true)
    void api
      .refreshFeed()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRefreshing(false))
  }

  const importPaper = (item: FeedItem): void => {
    setImporting(item.arxivId)
    void api
      .importPaper(`https://arxiv.org/abs/${item.arxivId}`)
      .then(() => onChanged())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setImporting(null))
  }

  return (
    <div className="feed">
      <div className="feed__bar">
        <div className="lang">
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => onLangChange('en')}>
            EN
          </button>
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => onLangChange('ja')}>
            JA
          </button>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 size={ICON} className="spin" aria-hidden /> : <RefreshCw size={ICON} aria-hidden />}
          取得
        </button>
      </div>

      {error !== null && <p className="error">{error}</p>}
      {items.length === 0 && error === null && <p className="empty">新着はありません</p>}

      <div className="feed__list">
        {items.map((item) => {
          const abstract = lang === 'ja' ? (item.abstractJa ?? item.abstract) : item.abstract
          return (
            <article key={item.arxivId} className={`feed-item ${item.read ? '' : 'feed-item--unread'}`}>
              <header>
                <h3>{item.title}</h3>
                {item.slug === null ? (
                  <button type="button" onClick={() => importPaper(item)} disabled={importing === item.arxivId}>
                    {importing === item.arxivId ? (
                      <Loader2 size={ICON} className="spin" aria-hidden />
                    ) : (
                      <Download size={ICON} aria-hidden />
                    )}
                    取り込む
                  </button>
                ) : (
                  <span className="feed-item__done">
                    <Check size={ICON} aria-hidden /> 取り込み済み
                  </span>
                )}
              </header>
              <p className="feed-item__meta">
                {item.authors.join(', ')} · {item.category} · {day(item.publishedAt)} ·{' '}
                <a href={`https://arxiv.org/abs/${item.arxivId}`} target="_blank" rel="noreferrer">
                  {item.arxivId}
                </a>
              </p>
              {abstract !== null && <p className="feed-item__abstract">{abstract}</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}
