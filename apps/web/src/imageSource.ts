/** markdown に書かれた画像の参照から、その実体を返す口を決める(0013)。 */

export type ImageContext = {
  /** 論文の本文を描いているときの slug。 */
  slug?: string | undefined
  /** 会話を描いているときの識別子。 */
  chatId?: string | undefined
}

export type ImageSource =
  | { kind: 'load'; url: string }
  /** コレクションの外を指している。 */
  | { kind: 'external'; url: string }
  /** どこを指すか決まらない。 */
  | { kind: 'unresolved'; raw: string }

const PAPER_FIGURE = /^@([^/]+)\/assets\/([^/]+)$/

const OWN_ASSET = /^(?:\.\/)?assets\/([^/]+)$/

export function imageSource(raw: string | undefined, context: ImageContext): ImageSource {
  if (raw === undefined || raw.trim().length === 0) return { kind: 'unresolved', raw: raw ?? '' }
  const source = raw.trim()

  if (/^https?:\/\//i.test(source)) return { kind: 'external', url: source }

  const figure = PAPER_FIGURE.exec(source)
  if (figure !== null) {
    const [, slug, name] = figure as unknown as [string, string, string]
    return { kind: 'load', url: `/api/papers/${encodeURIComponent(slug)}/assets/${encodeURIComponent(name)}` }
  }

  const own = OWN_ASSET.exec(source)
  if (own !== null) {
    const name = (own as unknown as [string, string])[1]
    if (context.slug !== undefined) {
      return { kind: 'load', url: `/api/papers/${encodeURIComponent(context.slug)}/assets/${encodeURIComponent(name)}` }
    }
    if (context.chatId !== undefined) {
      return { kind: 'load', url: `/api/chats/${encodeURIComponent(context.chatId)}/assets/${encodeURIComponent(name)}` }
    }
  }

  return { kind: 'unresolved', raw: source }
}
