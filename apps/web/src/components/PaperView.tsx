import { ArrowLeft, Check, Copy, List } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type PaperDetail, type Reference } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { PaperMetaTable } from './PaperMetaTable.tsx'
import { ReferenceList } from './ReferenceList.tsx'
import { splitAtReferences } from '../references.ts'
import { stripFrontMatterBlock } from '../frontMatterBlock.ts'
import { copyText } from '../clipboard.ts'

export type PaperViewProps = {
  detail: PaperDetail
  lang: 'en' | 'ja'
  onLangChange: (lang: 'en' | 'ja') => void
  /** 1 つ前に開いていた論文へ戻る。 */
  onBack: () => void
  /** 開いている論文を閉じて一覧へ戻る。 */
  onClose: () => void
  /** 戻り先が論文かどうか。参考文献から移ってきたときに立つ。 */
  backToPaper: boolean
  /** 参考文献から別の論文へ移る(0015)。 */
  onOpenPaper: (slug: string) => void
  onTagsChange: (tags: string[]) => void
}

const ICON = 16

export function PaperView({
  detail,
  lang,
  onLangChange,
  onBack,
  backToPaper,
  onClose,
  onOpenPaper,
  onTagsChange,
}: PaperViewProps) {
  const { meta } = detail
  const [copied, setCopied] = useState(false)
  const [references, setReferences] = useState<Reference[] | null>(null)
  // 読み終わるまでは、整理していない論文と見分けが付かない。
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setReferences(null)
    setLoaded(false)
    void api
      .paperReferences(meta.slug)
      .then((r) => setReferences(r.references))
      .catch(() => setReferences(null))
      .finally(() => setLoaded(true))
  }, [meta.slug])

  const text = lang === 'ja' ? (detail.bodyJa ?? '和訳はまだ無い') : detail.body
  const body = useMemo(() => stripFrontMatterBlock(text), [text])
  const split = useMemo(() => splitAtReferences(body), [body])

  return (
    <div className="paper-view">
      {/* 上部は固定する。長い本文を読んでいる間も戻れるようにするため(#17)。 */}
      <nav className="paper-nav">
        <button type="button" onClick={onClose}>
          <List size={ICON} aria-hidden /> 一覧
        </button>
        {/* 参考文献から移ってきたときだけ、1 つ前の論文へ戻れる。 */}
        {backToPaper ? (
          <button type="button" onClick={onBack}>
            <ArrowLeft size={ICON} aria-hidden /> 戻る
          </button>
        ) : null}

        {/* 言語は一覧と共通だが、本文を読んでいる途中でも切り替えられるようにする。 */}
        <div className="lang">
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => onLangChange('en')}>
            EN
          </button>
          <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => onLangChange('ja')}>
            JA
          </button>
        </div>


        <button
          type="button"
          onClick={() => void copyText(meta.slug).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        >
          {copied ? <Check size={ICON} aria-hidden /> : <Copy size={ICON} aria-hidden />} {meta.slug}
        </button>
      </nav>

      <article className="paper-body">
        <h1>{meta.title}</h1>
        {/* frontmatter が論文の正の情報なので、全項目を読めるようにする(0002)。 */}
        <PaperMetaTable meta={meta} onTagsChange={onTagsChange} />
        {/* 題と著者欄は frontmatter が担当するので、本文の側では隠す。 */}
        {split === null ? (
          <Markdown text={body} slug={meta.slug} linkReferences />
        ) : references !== null && references.length > 0 ? (
          <>
            <Markdown text={split.before} slug={meta.slug} linkReferences />
            <ReferenceList slug={meta.slug} references={references} onOpenPaper={onOpenPaper} />
            {split.after.length === 0 ? null : <Markdown text={split.after} slug={meta.slug} />}
          </>
        ) : (
          // まだ整理していない論文では、本文の節をそのまま出して整理を積めるようにする。
          <>
            <Markdown text={split.before} slug={meta.slug} linkReferences />
            {loaded ? <ReferenceList slug={meta.slug} references={null} onOpenPaper={onOpenPaper} /> : null}
            <Markdown text={`${split.section}\n\n${split.after}`} slug={meta.slug} />
          </>
        )}
      </article>
    </div>
  )
}
