/**
 * 会話の本文の `@slug` を、リンクの節点として取り出す(0024)。
 *
 * 文字列を置き換えるのではなく構文木を通すのは、コードとして囲んだ中の `@slug` を
 * 触らないためである。会話にはファイルの場所やコマンドを引用符で囲んで貼るので、
 * その中の `@slug` は文字として読まれるべきものである。構文木では地の文とコードが
 * 別の種類の節点になる。
 */

/** リンクの行き先に使う印。本文のリンクと見分けるために付ける。 */
export const MENTION_SCHEME = 'carrel-paper:'

/** 打つときに補完が入れる形と同じ綴り。 */
const MENTION = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g

type Node = {
  type: string
  value?: string
  url?: string
  children?: Node[]
}

function split(node: Node, known: (slug: string) => boolean): Node[] {
  const value = node.value ?? ''
  const parts: Node[] = []
  let last = 0
  for (const found of value.matchAll(MENTION)) {
    const slug = found[1] as string
    const at = found.index
    // 索引に無い slug は短縮しない。短縮されていること自体が、指す先がある印になる。
    if (!known(slug)) continue
    if (at > last) parts.push({ type: 'text', value: value.slice(last, at) })
    parts.push({ type: 'link', url: `${MENTION_SCHEME}${slug}`, children: [{ type: 'text', value: slug }] })
    last = at + found[0].length
  }
  if (parts.length === 0) return [node]
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) })
  return parts
}

function walk(node: Node, known: (slug: string) => boolean): void {
  const children = node.children
  if (children === undefined) return
  const next: Node[] = []
  for (const child of children) {
    if (child.type === 'text') {
      next.push(...split(child, known))
      continue
    }
    // リンクの中の `@slug` は、その文字が行き先の一部でありうるので触らない。
    if (child.type !== 'link' && child.type !== 'linkReference') walk(child, known)
    next.push(child)
  }
  node.children = next
}

export function remarkPaperMentions(options: { known: (slug: string) => boolean }) {
  return (tree: Node): void => walk(tree, options.known)
}
