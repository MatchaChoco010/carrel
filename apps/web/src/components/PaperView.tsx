import { ArrowLeft, Check, Copy, FileDiff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type PaperDetail } from '../api.ts'
import { copyText } from '../clipboard.ts'

export type PaperViewProps = {
  detail: PaperDetail
  onBack: () => void
}

const ICON = 16

type Pane = 'body' | 'verification' | 'raw'

export function PaperView({ detail, onBack }: PaperViewProps) {
  const { meta } = detail
  const [lang, setLang] = useState<'en' | 'ja'>('en')
  const [pane, setPane] = useState<Pane>('body')
  const [raw, setRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const hasJa = detail.bodyJa !== null && detail.bodyJa.length > 0

  useEffect(() => {
    if (pane !== 'raw' || raw !== null) return
    void api
      .paperRaw(meta.slug)
      .then((r) => setRaw(r.raw))
      .catch(() => setRaw('照合前の本文を読めなかった'))
  }, [pane, raw, meta.slug])

  const text =
    pane === 'verification'
      ? (detail.verification ?? '照合の記録は無い')
      : pane === 'raw'
        ? (raw ?? '読み込み中')
        : lang === 'ja'
          ? (detail.bodyJa ?? '和訳はまだ無い')
          : detail.body

  return (
    <div className="paper-view">
      {/* 上部は固定する。長い本文を読んでいる間も戻れるようにするため(#17)。 */}
      <nav className="paper-nav">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={ICON} aria-hidden /> 一覧
        </button>

        <div className="lang">
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
            EN
          </button>
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => setLang('ja')} disabled={!hasJa}>
            JA
          </button>
        </div>

        <button
          type="button"
          onClick={() => void copyText(meta.slug).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        >
          {copied ? <Check size={ICON} aria-hidden /> : <Copy size={ICON} aria-hidden />} {meta.slug}
        </button>

        <div className="panes">
          <button type="button" className={pane === 'body' ? 'on' : ''} onClick={() => setPane('body')}>
            本文
          </button>
          {detail.verification === null ? null : (
            <button
              type="button"
              className={pane === 'verification' ? 'on' : ''}
              onClick={() => setPane('verification')}
            >
              <FileDiff size={ICON} aria-hidden /> 照合の記録
            </button>
          )}
          {detail.hasRaw ? (
            <button type="button" className={pane === 'raw' ? 'on' : ''} onClick={() => setPane('raw')}>
              照合前
            </button>
          ) : null}
        </div>
      </nav>

      <article className="paper-body">
        <h1>{meta.title}</h1>
        <p className="meta">
          {meta.authors.join(', ')}
          {meta.venue === null ? '' : ` · ${meta.venue}`}
          {meta.year === null ? '' : ` · ${meta.year}`}
        </p>
        {/* markdown は素のまま出す。整形は後の段階で足す。 */}
        <pre>{text}</pre>
      </article>
    </div>
  )
}
