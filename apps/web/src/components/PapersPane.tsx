import { FilePlus2, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type PaperDetail, type SearchFilter, type SearchHit } from '../api.ts'
import { PaperCard } from './PaperCard.tsx'
import { PaperFilters } from './PaperFilters.tsx'
import { PaperView } from './PaperView.tsx'

export type PapersPaneProps = {
  lang: 'en' | 'ja'
  onLangChange: (lang: 'en' | 'ja') => void
  tags: Array<{ tag: string; count: number }>
  /** 索引が変わったことを知らせる。取り込みや削除の後に再読み込みする。 */
  revision: number
  onChanged: () => void
  /** 押した結果を知らせる(#229)。 */
  onNotify: (text: string, kind?: 'info' | 'error') => void
  /**
   * 開いている論文の履歴。末尾が今の論文で、参考文献から移るたびに伸びる(0015)。
   *
   * チャットの参照からも積むので、持ち主は画面全体である(0024)。
   */
  trail: string[]
  onTrailChange: (trail: string[]) => void
}

const ICON = 16

/** 一覧を 1 度に読む件数。末尾まで送るたびにこの分だけ増やす(#222)。 */
const PAGE = 20
const DEBOUNCE = 250

export function PapersPane({
  lang,
  onLangChange,
  tags,
  revision,
  onChanged,
  onNotify,
  trail,
  onTrailChange,
}: PapersPaneProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SearchFilter>({})
  const [hits, setHits] = useState<SearchHit[]>([])
  const [details, setDetails] = useState<Map<string, PaperDetail>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  /** いま求めている件数。一覧の末尾まで送るたびに増える(#222)。 */
  const [limit, setLimit] = useState(PAGE)
  const picker = useRef<HTMLInputElement>(null)
  const tail = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const { hits: found } = await api.search(query, filter, limit)
      setHits(found)
      const loaded = await Promise.all(
        found.map((h) =>
          api
            .paper(h.slug)
            .then((d) => [h.slug, d] as const)
            .catch(() => null),
        ),
      )
      setDetails(new Map(loaded.filter((x): x is readonly [string, PaperDetail] => x !== null)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [query, filter, limit])

  useEffect(() => {
    const timer = setTimeout(() => void load(), DEBOUNCE)
    return () => clearTimeout(timer)
  }, [load, revision])

  // 条件を変えたら最初の分量から出し直す。前の条件で伸ばした件数を持ち越さない。
  useEffect(() => {
    setLimit(PAGE)
  }, [query, filter])

  /**
   * 一覧の末尾が見えたら続きを求める(#222)。
   *
   * 送る欄はタブごとに違うので、どの欄が送られているかを知らずに済む見張りを使う。
   * 返った件数が求めた件数に満たなければ、それ以上は無い。
   */
  useEffect(() => {
    const node = tail.current
    if (node === null || hits.length < limit) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((previous) => previous + PAGE)
    })
    watcher.observe(node)
    return () => watcher.disconnect()
  }, [hits.length, limit])

  const open = trail.at(-1) ?? null

  // 参考文献から移った論文は検索の結果に無いことがあるので、その場で読む。
  useEffect(() => {
    if (open === null || details.has(open)) return
    let cancelled = false
    void api
      .paper(open)
      .then((detail) => {
        if (!cancelled) setDetails((prev) => new Map(prev).set(open, detail))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [open, details])

  const importPaper = async (): Promise<void> => {
    const target = url.trim()
    if (target.length === 0 || importing) return
    setImporting(true)
    setError(null)
    try {
      const result = await api.importPaper(target)
      if (result.error !== undefined) {
        onNotify(result.error, 'error')
      } else if (result.kind === 'duplicate') {
        onNotify(`既に取り込んでいる: ${result.slug ?? ''}`)
        setUrl('')
      } else if (result.kind === 'resumed' || result.kind === 'restarted') {
        // 失敗した取り込みを押し直したときは、そこから続く(#220)。進みはジョブの欄に出る。
        onNotify(`取り込みを続きから動かし直した: ${result.slug ?? ''}`)
        setUrl('')
      } else {
        // 解決も取得も仕事の中で行うので、ここでは積んだところまでしか分からない。
        setUrl('')
      }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  /**
   * 手元の PDF を原本として上げる(0021)。
   *
   * 上げ終わった時点で取り込みが積まれる。何の論文かは解決の段階が原本を読んで決めるので、
   * ここで題名を尋ねない。
   */
  const uploadPaper = async (file: File): Promise<void> => {
    if (importing) return
    setImporting(true)
    setError(null)
    try {
      await api.uploadPaper(file)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const setTags = async (slug: string, next: string[]): Promise<void> => {
    try {
      await api.setTags(slug, next)
      const detail = details.get(slug)
      if (detail !== undefined) {
        setDetails(new Map(details).set(slug, { ...detail, meta: { ...detail.meta, tags: next } }))
      }
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (slug: string): Promise<void> => {
    try {
      await api.deletePaper(slug)
      setHits(hits.filter((h) => h.slug !== slug))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (open !== null) {
    const opened = details.get(open)
    if (opened === undefined) return <p className="empty">読み込み中</p>
    return (
      <PaperView
        detail={opened}
        lang={lang}
        onLangChange={onLangChange}
        onBack={() => onTrailChange(trail.slice(0, -1))}
        backToPaper={trail.length > 1}
        onClose={() => onTrailChange([])}
        onOpenPaper={(slug) => onTrailChange([...trail, slug])}
        onTagsChange={(next) => void setTags(opened.meta.slug, next)}
      />
    )
  }

  return (
    <div className="papers">
      <div className="import">
        {/* 表示の言語は一覧と本文で共通にする。まとめて日本語で読むための切り替え。 */}
        <div className="lang">
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => onLangChange('en')}>
            EN
          </button>
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => onLangChange('ja')}>
            JA
          </button>
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void importPaper()}
          placeholder="論文の URL か題名を入れて取り込む"
          aria-label="取り込む論文の URL か題名"
        />
        {/* 取り込み中は実行中の表示にして二度押しを防ぐ(#17)。 */}
        <button type="button" onClick={() => void importPaper()} disabled={importing || url.trim().length === 0}>
          {importing ? <Loader2 size={ICON} className="spin" aria-hidden /> : <Plus size={ICON} aria-hidden />}
          {importing ? '取り込み中' : '取り込む'}
        </button>
        {/* 出版社のページから原本を取れない論文は、手元に落とした PDF から入れる(0021)。 */}
        <button
          type="button"
          className="ghost"
          onClick={() => picker.current?.click()}
          disabled={importing}
          title="手元の PDF を取り込む"
          aria-label="手元の PDF を取り込む"
        >
          <FilePlus2 size={ICON} aria-hidden />
          PDF
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            // 同じファイルをもう一度選べるように、値を落としてから上げる。
            event.target.value = ''
            if (file !== undefined) void uploadPaper(file)
          }}
        />
      </div>

      <PaperFilters query={query} filter={filter} tags={tags} onQueryChange={setQuery} onFilterChange={setFilter} />

      {error === null ? null : <p className="error">{error}</p>}

      {loading && hits.length === 0 ? (
        <p className="empty">読み込み中</p>
      ) : hits.length === 0 ? (
        <p className="empty">条件に当たる論文は無い</p>
      ) : (
        <div className="paper-list">
          {hits.map((hit) => {
            const detail = details.get(hit.slug)
            if (detail === undefined) return null
            return (
              <PaperCard
                key={hit.slug}
                detail={detail}
                lang={lang}
                hit={hit.path.length > 0 ? { path: hit.path, excerpt: hit.excerpt } : undefined}
                onOpen={(slug) => onTrailChange([slug])}
                onTagsChange={(slug, next) => void setTags(slug, next)}
                onDelete={(slug) => void remove(slug)}
              />
            )
          })}
          {/* 末尾の見張り。ここが見えたら続きを読む(#222)。 */}
          <div ref={tail} className="paper-list__tail" aria-hidden />
        </div>
      )}
    </div>
  )
}
