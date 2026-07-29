/**
 * 本文の引用を、参考文献の節へのリンクにする。
 *
 * 論文の引用は `[Müller et al. 2022]` や `[Barron et al. 2022; Hedman et al. 2018]`
 * の形で本文に現れる。読んでいる途中でその文献を見に行けるようにする。
 *
 * 引く先は参考文献の**節**であって、個々の項目ではない。変換器が返す参考文献は
 * 1 項目ずつに分かれているとは限らず、複数の文献が 1 つの塊に潰れることがある。
 * 実測では 100 件近い文献が 3 つの塊になっていた。個々の項目へ飛ばそうとすると、
 * 潰れた塊の中の誤った位置へ飛ぶか、多くの引用がリンクにならないかのどちらかに
 * なる。節の先頭へ飛ばして、そこから探してもらうほうが確かである。
 */

/** `[...]` のうち、年号を含むものだけを引用とみなす。 */
const CITATION = /\[([^\][]*\b(?:19|20)\d{2}[a-z]?[^\][]*)\]/g

/** 参考文献の節の見出し。 */
const REFERENCES_HEADING = /^#{1,6}\s+(REFERENCES|References|参考文献)\s*$/m

/** 引用から飛ぶ先の目印。 */
export const REFERENCES_ID = 'references'

export function hasReferences(markdown: string): boolean {
  return REFERENCES_HEADING.test(markdown)
}

/**
 * 本文の引用をリンクにし、参考文献の節へ目印を置く。
 *
 * 参考文献の節が無ければ何もしない。存在しない場所へ飛ぶリンクを作ると、押して
 * も何も起きない箇所ができる。
 */
export function linkCitations(markdown: string): string {
  const at = markdown.search(REFERENCES_HEADING)
  if (at < 0) return markdown

  const body = markdown.slice(0, at)
  const tail = markdown.slice(at)

  const linked = body.replace(CITATION, (_whole, inner: string) => `[[${inner}]](#${REFERENCES_ID})`)
  return `${linked}<a id="${REFERENCES_ID}"></a>\n\n${tail}`
}
