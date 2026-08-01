import 'katex/dist/katex.min.css'
import { memo, useMemo, type MouseEvent } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'
import { linkCitations } from '../citations.ts'
import { imageSource } from '../imageSource.ts'
import { normalizeMathDelimiters } from '../mathDelimiters.ts'
import type { Mention } from '../paper-mention.ts'
import { MENTION_SCHEME, remarkPaperMentions } from '../remark-mentions.ts'
import { PaperMention } from './PaperMention.tsx'

export type MarkdownProps = {
  text: string
  /** 図の画像を引くための論文の slug。 */
  slug?: string
  /** 添付を引くための会話の識別子。会話を描くときに渡す(0013)。 */
  chatId?: string | undefined
  /** 引用を参考文献へのリンクにするか。本文だけで、記録の表示では要らない。 */
  linkReferences?: boolean
  /**
   * `@slug` を短く出すための対応表(0024)。会話を描くときに渡す。
   *
   * 描き直しのたびに作り直すと本文を組み立て直すことになるので、呼ぶ側で持ち回る。
   */
  mentions?: Map<string, Mention> | undefined
  /** 参照から論文の詳細へ移る(0024)。描き直しをまたぐので、呼ぶ側で持ち回る。 */
  onOpenPaper?: ((slug: string) => void) | undefined
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

function MarkdownView({ text, slug, chatId, linkReferences = false, mentions, onOpenPaper }: MarkdownProps) {
  const source = useMemo(() => {
    const normalized = normalizeMathDelimiters(text)
    return linkReferences ? linkCitations(normalized) : normalized
  }, [text, linkReferences])

  const plugins: PluggableList = useMemo(
    () =>
      mentions === undefined
        ? [remarkGfm, remarkMath]
        : [remarkGfm, remarkMath, [remarkPaperMentions, { known: (slug: string) => mentions.has(slug) }]],
    [mentions],
  )

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        // 参照の印は既定の変換が落とすので、これだけ通す(0024)。
        urlTransform={(url) => (url.startsWith(MENTION_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          img: ({ src, alt }) => {
            const image = imageSource(typeof src === 'string' ? src : undefined, { slug, chatId })
            // 外の画像は取りに行かない(0013)。
            if (image.kind === 'external') {
              return (
                <a href={image.url} target="_blank" rel="noreferrer" className="markdown__external-image">
                  {alt !== undefined && alt.length > 0 ? alt : image.url}
                </a>
              )
            }
            if (image.kind === 'unresolved') {
              return <span className="markdown__missing-image">画像を引けない: {image.raw}</span>
            }
            return <img src={image.url} alt={alt ?? ''} loading="lazy" />
          },
          a: ({ href, children }) => {
            if (typeof href === 'string' && href.startsWith(MENTION_SCHEME)) {
              const mentioned = href.slice(MENTION_SCHEME.length)
              const mention = mentions?.get(mentioned)
              // 対応表から引けなければ、書き手が打った形をそのまま出す。
              return mention === undefined ? (
                <>@{mentioned}</>
              ) : (
                <PaperMention mention={mention} onOpen={onOpenPaper} />
              )
            }
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

/**
 * 同じ markdown を二度組み立てない。
 *
 * 会話の欄は応答の途中で何度も描き直される。メモ化しないと、そのたびに過去の
 * 発言まで解析と数式のレイアウトをやり直すことになる。実測で 200 発言の会話では
 * 1 回の描き直しに 1.2 秒かかっていた。
 */
export const Markdown = memo(MarkdownView)
