import { ExternalLink } from 'lucide-react'
import type { PaperMeta } from '../api.ts'

export type PaperMetaTableProps = {
  meta: PaperMeta
}

const ICON = 13

function formatDate(value: string): string {
  // frontmatter の時刻は時差を保った形で入っている(0002)。表示は日付までで足りる。
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m === null ? value : `${m[1]}-${m[2]}-${m[3]}`
}

/**
 * frontmatter の内容を一覧で出す。
 *
 * frontmatter が論文の正の情報なので(0002)、本文のページで全項目を読めるように
 * する。本文の側にも著者欄が残るが、そちらは紙面をそのまま写したものである。
 */
export function PaperMetaTable({ meta }: PaperMetaTableProps) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'slug', value: <code>{meta.slug}</code> },
    { label: '著者', value: meta.authors.length === 0 ? '—' : meta.authors.join(', ') },
    { label: '学会名', value: meta.venue ?? '—' },
    { label: '出版年', value: meta.year === null ? '—' : String(meta.year) },
    { label: 'arXiv', value: meta.arxivId ?? '—' },
    {
      label: '出所',
      value: (
        <a href={meta.sourceUrl} target="_blank" rel="noreferrer">
          {meta.sourceUrl} <ExternalLink size={ICON} aria-hidden />
        </a>
      ),
    },
    {
      label: '原本',
      value:
        meta.pdfUrl === null ? (
          '—'
        ) : (
          <a href={meta.pdfUrl} target="_blank" rel="noreferrer">
            {meta.pdfUrl} <ExternalLink size={ICON} aria-hidden />
          </a>
        ),
    },
    {
      label: 'タグ',
      value:
        meta.tags.length === 0 ? (
          '—'
        ) : (
          <span className="tags">
            {meta.tags.map((tag) => (
              <span key={tag} className="tag on">
                {tag}
              </span>
            ))}
          </span>
        ),
    },
    { label: '追加日', value: formatDate(meta.addedAt) },
  ]

  return (
    <dl className="paper-meta">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
