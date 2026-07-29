import { Check, Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PaperDetail } from '../api.ts'
import { copyText } from '../clipboard.ts'

export type PaperCardProps = {
  detail: PaperDetail
  /** 検索で当たった箇所。語句なしの一覧では無い。 */
  hit?: { path: string; excerpt: string } | undefined
  onOpen: (slug: string) => void
  onTagsChange: (slug: string, tags: string[]) => void
  onDelete: (slug: string) => void
}

const ICON = 15
/** 一覧で畳まずに出す abstract の長さ。 */
const ABSTRACT_PREVIEW = 320

export function PaperCard({ detail, hit, onOpen, onTagsChange, onDelete }: PaperCardProps) {
  const { meta } = detail
  // 保存済みの訳を切り替えるだけで、訳し直しは起こさない(#17)。
  const [lang, setLang] = useState<'en' | 'ja'>('en')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)

  const [expanded, setExpanded] = useState(false)
  const full = lang === 'ja' ? detail.abstractJa : detail.abstract
  // 一覧では長い abstract を畳む。開けば全文を読める。
  const abstract = full === null || expanded || full.length <= ABSTRACT_PREVIEW ? full : `${full.slice(0, ABSTRACT_PREVIEW)}…`
  const hasJa = detail.abstractJa !== null && detail.abstractJa.length > 0

  const addTag = (): void => {
    const tag = draft.trim()
    setDraft('')
    setAdding(false)
    if (tag.length > 0 && !meta.tags.includes(tag)) onTagsChange(meta.slug, [...meta.tags, tag])
  }

  return (
    <article className="paper">
      <header>
        <button type="button" className="title" onClick={() => onOpen(meta.slug)}>
          {meta.title}
        </button>
        <div className="menu">
          <button type="button" className="ghost" aria-label="この論文の操作" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreHorizontal size={ICON} aria-hidden />
          </button>
          {menuOpen ? (
            <div className="menu-items" role="menu">
              {/* 一度の操作で消えないよう、確認を挟む(#17)。 */}
              <button type="button" role="menuitem" onClick={() => (setMenuOpen(false), setConfirming(true))}>
                <Trash2 size={ICON} aria-hidden /> 削除
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <p className="meta">
        {meta.authors.join(', ')}
        {meta.venue === null ? '' : ` · ${meta.venue}`}
        {meta.year === null ? '' : ` · ${meta.year}`}
      </p>

      <p className="slug">
        <code>{meta.slug}</code>
        <button
          type="button"
          className="ghost"
          aria-label="slug をコピー"
          onClick={() => void copyText(meta.slug).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        >
          {copied ? <Check size={ICON} aria-hidden /> : <Copy size={ICON} aria-hidden />}
        </button>
      </p>

      {hit === undefined ? null : (
        <p className="hit">
          <span className="path">{hit.path}</span>
          {hit.excerpt}
        </p>
      )}

      {abstract === null || abstract.length === 0 ? null : (
        <div className="abstract">
          <div className="lang">
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button type="button" className={lang === 'ja' ? 'on' : ''} onClick={() => setLang('ja')} disabled={!hasJa}>
              JA
            </button>
          </div>
          <div>
            <p>{abstract}</p>
            {full !== null && full.length > ABSTRACT_PREVIEW ? (
              <button type="button" className="ghost" onClick={() => setExpanded(!expanded)}>
                {expanded ? '畳む' : '続きを読む'}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="tags">
        {meta.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="tag on"
            onClick={() => onTagsChange(meta.slug, meta.tags.filter((t) => t !== tag))}
            aria-label={`タグ ${tag} を外す`}
          >
            {tag} ×
          </button>
        ))}
        {adding ? (
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
          <button type="button" className="tag add" onClick={() => setAdding(true)} aria-label="タグを足す">
            <Plus size={13} aria-hidden />
          </button>
        )}
      </div>

      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="削除の確認">
          <p>
            <strong>{meta.title}</strong> を削除する。論文のディレクトリごと消える。
          </p>
          <div>
            <button type="button" className="danger" onClick={() => (setConfirming(false), onDelete(meta.slug))}>
              削除する
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
    </article>
  )
}
