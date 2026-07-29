import { ExternalLink, Plus } from 'lucide-react'
import { useState } from 'react'
import type { PaperMeta } from '../api.ts'

export type PaperMetaTableProps = {
  meta: PaperMeta
  /** タグを編集できるようにする。省くと表示だけになる。 */
  onTagsChange?: (tags: string[]) => void
}

const ICON = 13

function formatDate(value: string): string {
  // 時刻は時差つきで入っているので、日付の部分だけを取る。
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m === null ? value : `${m[1]}-${m[2]}-${m[3]}`
}

export function PaperMetaTable({ meta, onTagsChange }: PaperMetaTableProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const addTag = (): void => {
    const tag = draft.trim()
    setDraft('')
    setAdding(false)
    if (tag.length > 0 && !meta.tags.includes(tag)) onTagsChange?.([...meta.tags, tag])
  }

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
      value: (
        <span className="tags">
          {meta.tags.map((tag) =>
            onTagsChange === undefined ? (
              <span key={tag} className="tag on">
                {tag}
              </span>
            ) : (
              <button
                key={tag}
                type="button"
                className="tag on"
                onClick={() => onTagsChange(meta.tags.filter((t) => t !== tag))}
                aria-label={`タグ ${tag} を外す`}
              >
                {tag} ×
              </button>
            ),
          )}
          {onTagsChange === undefined ? (
            meta.tags.length === 0 ? (
              '—'
            ) : null
          ) : adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={addTag}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag()
                if (e.key === 'Escape') (setDraft(''), setAdding(false))
              }}
              aria-label="新しいタグ"
              placeholder="タグ"
            />
          ) : (
            <button type="button" className="tag add" onClick={() => setAdding(true)}>
              <Plus size={13} aria-hidden /> タグ
            </button>
          )}
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
