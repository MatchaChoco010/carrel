import { Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FeedItem } from '../api.ts'
import type { Lang } from '../useLang.ts'

export type FeedPaneProps = {
  lang: Lang
  onLangChange: (lang: Lang) => void
  /** この欄が今おもてに出ているか。隠れている間は既読にしない。 */
  visible: boolean
  revision: number
  /** 未読数を伝える。アイコンのバッジがこれを出す。 */
  onUnread: (count: number) => void
  onChanged: () => void
  /**
   * 仕事の動きを親から受ける(#295)。
   *
   * 取り込みが失敗しても論文は増えないので、論文の増減だけを見ていると実行中の表示が
   * 残り続ける。
   */
  subscribe: (handler: (event: { type: string; payload: unknown }) => void) => () => void
}

const ICON = 15

function day(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function FeedPane({ lang, onLangChange, visible, revision, onUnread, onChanged, subscribe }: FeedPaneProps) {
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

  // 隠れている間は読み直さない。おもてに戻ったときに読み直して、離れていた間の新着を出す。
  useEffect(() => {
    if (!visible) return
    load()
  }, [load, visible, revision])

  /**
   * 仕事が動いたら読み直して、取り込みの表示を追う(#295)。
   *
   * 取り込み 1 本で仕事は何度も動くので、まとめて 1 回にする。
   */
  useEffect(() => {
    if (!visible) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = subscribe((event) => {
      if (event.type !== 'job.changed') return
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        load()
      }, 500)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      stop()
    }
  }, [load, visible, subscribe])

  // 画面に出た時点で既読にする(0004)。他のタブに移っている間は出ていないので既読にしない。
  useEffect(() => {
    if (!visible) return
    const unread = items.filter((i) => !i.read && !marked.current.has(i.arxivId)).map((i) => i.arxivId)
    if (unread.length === 0) return
    for (const id of unread) marked.current.add(id)
    void api.markFeedRead(unread).then((r) => onUnread(r.unread))
  }, [items, visible, onUnread])

  const refresh = (): void => {
    setRefreshing(true)
    void api
      .refreshFeed()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRefreshing(false))
  }

  /**
   * 取り込みを積む(#295)。
   *
   * 押した直後は返事を待つ間だけこちらで実行中にし、返った後はサーバーの `importing` に
   * 任せる。積むところまでしか返らないので、これを解除の合図にすると実行中が一瞬で消える。
   */
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
                {item.slug !== null ? (
                  <span className="feed-item__done">
                    <Check size={ICON} aria-hidden /> 取り込み済み
                  </span>
                ) : item.importing || importing === item.arxivId ? (
                  <button type="button" disabled>
                    <Loader2 size={ICON} className="spin" aria-hidden />
                    取り込み中
                  </button>
                ) : (
                  <button type="button" onClick={() => importPaper(item)}>
                    <Download size={ICON} aria-hidden />
                    取り込む
                  </button>
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
