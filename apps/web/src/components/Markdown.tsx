import 'katex/dist/katex.min.css'
import { useMemo, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { linkCitations } from '../citations.ts'
import { normalizeMathDelimiters } from '../mathDelimiters.ts'

export type MarkdownProps = {
  text: string
  /** 図の画像を引くための論文の slug。 */
  slug?: string
  /** 引用を参考文献へのリンクにするか。本文だけで、記録の表示では要らない。 */
  linkReferences?: boolean
}

/**
 * 同じページの中の目印へ送る。
 *
 * 本文は画面の中の枠がスクロールするので、素の `#id` の移動では枠が動かない。
 */
function scrollToAnchor(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  const target = document.getElementById(id)
  if (target === null) return
  event.preventDefault()
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function Markdown({ text, slug, linkReferences = false }: MarkdownProps) {
  const source = useMemo(() => {
    const normalized = normalizeMathDelimiters(text)
    return linkReferences ? linkCitations(normalized) : normalized
  }, [text, linkReferences])

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          img: ({ src, alt }) => {
            // 本文の中の参照は `assets/...` の相対で書かれている(0004)。
            const source =
              typeof src === 'string' && !src.startsWith('http') && slug !== undefined
                ? `/api/papers/${encodeURIComponent(slug)}/${src}`
                : src
            return <img src={typeof source === 'string' ? source : ''} alt={alt ?? ''} loading="lazy" />
          },
          a: ({ href, children }) => {
            const internal = typeof href === 'string' && href.startsWith('#')
            return (
              <a
                href={href}
                className={internal ? 'citation' : undefined}
                {...(internal
                  ? { onClick: (event: MouseEvent<HTMLAnchorElement>) => scrollToAnchor(event, href.slice(1)) }
                  : { target: '_blank', rel: 'noreferrer' })}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
