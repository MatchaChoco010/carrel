import { BookOpen, ExternalLink, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Reference } from '../api.ts'

export type ReferencesPaneProps = {
  slug: string
  /** 参考文献から別の論文へ移る。 */
  onOpenPaper: (slug: string) => void
}

const ICON = 14

/** 取り込みを押した後の状態。結果は仕事の一覧で進む(0004)。 */
type Queued = 'queued' | 'duplicate' | string

export function ReferencesPane({ slug, onOpenPaper }: ReferencesPaneProps) {
  const [references, setReferences] = useState<Reference[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState<Map<number, Queued>>(new Map())
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)

  useEffect(() => {
    setLoading(true)
    setQueued(new Map())
    api
      .paperReferences(slug)
      .then((r) => setReferences(r.references))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [slug])

  const build = async (): Promise<void> => {
    setBuilding(true)
    setError(null)
    try {
      await api.buildReferences(slug)
      setBuilt(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const importPaper = async (at: number, reference: Reference): Promise<void> => {
    setQueued(new Map(queued).set(at, 'queued'))
    try {
      const result = await api.importPaper(reference.title)
      if (result.error !== undefined) setQueued(new Map(queued).set(at, result.error))
      else if (result.kind === 'duplicate') setQueued(new Map(queued).set(at, 'duplicate'))
    } catch (e) {
      setQueued(new Map(queued).set(at, e instanceof Error ? e.message : String(e)))
    }
  }

  if (loading) return <p className="empty">読み込み中</p>

  if (references === null) {
    return (
      <div className="references">
        {error === null ? null : <p className="error">{error}</p>}
        <p className="empty">
          {built ? (
            '参考文献の整理を積んだ。仕上がったらこの画面を開き直す。'
          ) : (
            <>
              参考文献はまだ整理していない。
              {/* 取り込みより前に入れた論文と、段階が失敗した論文はここから積み直す(0015)。 */}
              <button type="button" onClick={() => void build()} disabled={building}>
                {building ? <Loader2 size={ICON} className="spin" aria-hidden /> : null} 参考文献を整理する
              </button>
            </>
          )}
        </p>
      </div>
    )
  }

  if (references.length === 0) return <p className="empty">参考文献は無い</p>

  return (
    <div className="references">
      {error === null ? null : <p className="error">{error}</p>}
      <ol className="reference-list">
        {references.map((reference, at) => {
          const state = queued.get(at)
          return (
            <li key={`${at}-${reference.text.slice(0, 40)}`} className="reference">
              <p className="reference__text">{reference.text}</p>
              <div className="reference__actions">
                {reference.importedSlug !== null ? (
                  <button type="button" className="on" onClick={() => onOpenPaper(reference.importedSlug as string)}>
                    <BookOpen size={ICON} aria-hidden /> {reference.importedSlug}
                  </button>
                ) : reference.kind === 'paper' ? (
                  <button type="button" onClick={() => void importPaper(at, reference)} disabled={state !== undefined}>
                    <Plus size={ICON} aria-hidden /> 取り込む
                  </button>
                ) : null}
                {reference.url === null ? null : (
                  <a href={reference.url} target="_blank" rel="noreferrer">
                    リンク <ExternalLink size={ICON} aria-hidden />
                  </a>
                )}
                {state === undefined ? null : (
                  <span className={state === 'queued' || state === 'duplicate' ? 'reference__queued' : 'error'}>
                    {state === 'queued' ? '取り込みを積んだ' : state === 'duplicate' ? '既に取り込んでいる' : state}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
