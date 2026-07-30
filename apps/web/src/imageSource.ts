/**
 * markdown に書かれた画像の参照を、実体を返す口へ読み替える(0013)。
 *
 * 記録に残るのは人が読める参照だけで、口の形は記録に入らない。読み替えはここに閉じる。
 */

export type ImageContext = {
  /** 論文の本文を描いているときの slug。図は `assets/...` の相対で書かれている(0004)。 */
  slug?: string | undefined
  /** 会話を描いているときの識別子。添付は `assets/...` の相対で書かれている(0013)。 */
  chatId?: string | undefined
}

export type ImageSource =
  /** 読み込んで良い場所。 */
  | { kind: 'load'; url: string }
  /** コレクションの外なので読み込まない。リンクとして出す。 */
  | { kind: 'external'; url: string }
  /** どこを指すか決まらない。 */
  | { kind: 'unresolved'; raw: string }

/** `@<slug>/assets/<名前>` の形。論文の図を指す。 */
const PAPER_FIGURE = /^@([^/]+)\/assets\/([^/]+)$/

/** `assets/<名前>` の形。いま描いているもの(論文の本文か会話)に属する。 */
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
