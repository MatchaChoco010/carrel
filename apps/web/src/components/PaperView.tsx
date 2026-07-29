import { ArrowLeft, Check, Copy, FileDiff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type PaperDetail } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { PaperMetaTable } from './PaperMetaTable.tsx'
import { stripFrontMatterBlock } from '../frontMatterBlock.ts'
import { copyText } from '../clipboard.ts'

export type PaperViewProps = {
  detail: PaperDetail
  lang: 'en' | 'ja'
  onBack: () => void
  onTagsChange: (tags: string[]) => void
}

const ICON = 16

type Pane = 'body' | 'verification' | 'raw'

export function PaperView({ detail, lang, onBack, onTagsChange }: PaperViewProps) {
  const { meta } = detail
  const [pane, setPane] = useState<Pane>('body')
  const [raw, setRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // abstract も本文と同じ言語の切り替えに従う。
  const abstract = lang === 'ja' ? (detail.abstractJa ?? detail.abstract) : detail.abstract

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
        {/* frontmatter が論文の正の情報なので、全項目を読めるようにする(0002)。 */}
        <PaperMetaTable meta={meta} onTagsChange={onTagsChange} />
        {abstract === null || abstract.length === 0 ? null : (
          <section className="paper-abstract">
            <h2>abstract</h2>
            <Markdown text={abstract} slug={meta.slug} />
          </section>
        )}
        {/* 照合の記録と照合前の本文も markdown なので、同じ描き方でよい。 */}
        {/* 題と著者欄は frontmatter が担当するので、本文の側では隠す。 */}
        <Markdown text={pane === 'body' ? stripFrontMatterBlock(text) : text} slug={meta.slug} linkReferences={pane === 'body'} />
      </article>
    </div>
  )
}
