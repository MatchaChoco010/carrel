import { ArrowLeft, Check, Copy, List } from 'lucide-react'
import { useState } from 'react'
import type { PaperDetail } from '../api.ts'
import { Markdown } from './Markdown.tsx'
import { PaperMetaTable } from './PaperMetaTable.tsx'
import { ReferencesPane } from './ReferencesPane.tsx'
import { stripFrontMatterBlock } from '../frontMatterBlock.ts'
import { copyText } from '../clipboard.ts'

export type PaperViewProps = {
  detail: PaperDetail
  lang: 'en' | 'ja'
  onLangChange: (lang: 'en' | 'ja') => void
  /** 1 つ前に開いていた論文へ戻る。履歴が無ければ一覧へ戻る。 */
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

type Pane = 'body' | 'references'

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
  const [pane, setPane] = useState<Pane>('body')
  const [copied, setCopied] = useState(false)

  const text = lang === 'ja' ? (detail.bodyJa ?? '和訳はまだ無い') : detail.body

  return (
    <div className="paper-view">
      {/* 上部は固定する。長い本文を読んでいる間も戻れるようにするため(#17)。 */}
      <nav className="paper-nav">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={ICON} aria-hidden /> {backToPaper ? '戻る' : '一覧'}
        </button>
        {/* 参考文献をいくつも辿った後に、1 つずつ戻らずに一覧へ帰れるようにする。 */}
        {backToPaper ? (
          <button type="button" onClick={onClose}>
            <List size={ICON} aria-hidden /> 一覧
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

        <div className="panes">
          <button type="button" className={pane === 'body' ? 'on' : ''} onClick={() => setPane('body')}>
            本文
          </button>
          <button type="button" className={pane === 'references' ? 'on' : ''} onClick={() => setPane('references')}>
            参考文献
          </button>
        </div>
      </nav>

      <article className="paper-body">
        <h1>{meta.title}</h1>
        {/* frontmatter が論文の正の情報なので、全項目を読めるようにする(0002)。 */}
        <PaperMetaTable meta={meta} onTagsChange={onTagsChange} />
        {pane === 'references' ? (
          <ReferencesPane slug={meta.slug} onOpenPaper={onOpenPaper} />
        ) : (
          // 題と著者欄は frontmatter が担当するので、本文の側では隠す。
          <Markdown text={stripFrontMatterBlock(text)} slug={meta.slug} linkReferences />
        )}
      </article>
    </div>
  )
}
