import { BookOpen, ExternalLink, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type Reference } from '../api.ts'

export type ReferenceListProps = {
  /** 本文の参考文献の節の位置に並べる参考文献。 */
  references: Reference[]
  /** 参考文献から別の論文へ移る。 */
  onOpenPaper: (target: string) => void
}

const ICON = 14

/** 取り込みを押した後の状態。結果は仕事の一覧で進む(0004)。 */
type Queued = 'queued' | 'duplicate' | string

/**
 * 原文の中の題を太字にする。
 *
 * 1 件は著者・題・掲載誌が続けて書かれていて、同じ太さだと目が留まらない。原文を
 * そのまま出す(0015)ので、書き換えずに題の位置だけを強める。題が原文と一字一句
 * 揃わないときは、そのまま出す。
 */
function withTitle(text: string, title: string): ReactNode {
  const at = title.length === 0 ? -1 : text.toLowerCase().indexOf(title.toLowerCase())
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <span className="reference__title">{text.slice(at, at + title.length)}</span>
      {text.slice(at + title.length)}
    </>
  )
}

/** 本文の参考文献の節に差し込む一覧(0017)。 */
export function ReferenceList({ references, onOpenPaper }: ReferenceListProps) {
  const [queued, setQueued] = useState<Map<number, Queued>>(new Map())
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="references">
      {error === null ? null : <p className="error">{error}</p>}
      <ol className="reference-list">
        {references.map((reference, at) => {
          const state = queued.get(at)
          return (
            <li key={`${at}-${reference.text.slice(0, 40)}`} className="reference">
              <p className="reference__text">{withTitle(reference.text, reference.title)}</p>
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
