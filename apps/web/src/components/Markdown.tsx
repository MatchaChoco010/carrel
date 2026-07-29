import 'katex/dist/katex.min.css'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { linkCitations } from '../citations.ts'

export type MarkdownProps = {
  text: string
  /** 図の画像を引くための論文の slug。 */
  slug?: string
  /** 引用を参考文献へのリンクにするか。本文だけで、記録の表示では要らない。 */
  linkReferences?: boolean
}

/**
 * 論文の本文を markdown として描く。
 *
 * 表(remark-gfm)と数式(remark-math と rehype-katex)を扱う。変換の段階が数式を
 * `$$` で囲むので(0008)、そのまま組版される。図とキャプションは `<figure>` で
 * 返るため(0004)、生の HTML も通す。
 */
export function Markdown({ text, slug, linkReferences = false }: MarkdownProps) {
  const source = useMemo(() => (linkReferences ? linkCitations(text) : text), [text, linkReferences])

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
            // 参考文献へのリンクは同じページの中を飛ぶ。
            const internal = typeof href === 'string' && href.startsWith('#')
            return (
              <a
                href={href}
                className={internal ? 'citation' : undefined}
                {...(internal ? {} : { target: '_blank', rel: 'noreferrer' })}
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
