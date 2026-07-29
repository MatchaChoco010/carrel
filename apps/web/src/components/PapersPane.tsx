import { Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type PaperDetail, type SearchFilter, type SearchHit } from '../api.ts'
import { PaperCard } from './PaperCard.tsx'
import { PaperFilters } from './PaperFilters.tsx'
import { PaperView } from './PaperView.tsx'

export type PapersPaneProps = {
  tags: Array<{ tag: string; count: number }>
  /** 索引が変わったことを知らせる。取り込みや削除の後に再読み込みする。 */
  revision: number
  onChanged: () => void
}

const ICON = 16
const DEBOUNCE = 250

export function PapersPane({ tags, revision, onChanged }: PapersPaneProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SearchFilter>({})
  const [hits, setHits] = useState<SearchHit[]>([])
  const [details, setDetails] = useState<Map<string, PaperDetail>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [url, setUrl] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const { hits: found } = await api.search(query, filter)
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
  }, [query, filter])

  // 入力のたびに問い合わせず、少し待ってからまとめて送る。
  useEffect(() => {
    const timer = setTimeout(() => void load(), DEBOUNCE)
    return () => clearTimeout(timer)
  }, [load, revision])

  const importPaper = async (): Promise<void> => {
    const target = url.trim()
    if (target.length === 0 || importing) return
    setImporting(true)
    setError(null)
    try {
      const result = await api.importPaper(target)
      if (result.error !== undefined) setError(result.error)
      else setUrl('')
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

  const opened = open === null ? undefined : details.get(open)
  if (opened !== undefined) {
    return <PaperView detail={opened} onBack={() => setOpen(null)} />
  }

  return (
    <div className="papers">
      <div className="import">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void importPaper()}
          placeholder="論文の URL を貼って取り込む"
          aria-label="取り込む論文の URL"
        />
        {/* 取り込み中は実行中の表示にして二度押しを防ぐ(#17)。 */}
        <button type="button" onClick={() => void importPaper()} disabled={importing || url.trim().length === 0}>
          {importing ? <Loader2 size={ICON} className="spin" aria-hidden /> : <Plus size={ICON} aria-hidden />}
          {importing ? '取り込み中' : '取り込む'}
        </button>
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
                hit={hit.path.length > 0 ? { path: hit.path, excerpt: hit.excerpt } : undefined}
                onOpen={setOpen}
                onTagsChange={(slug, next) => void setTags(slug, next)}
                onDelete={(slug) => void remove(slug)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
