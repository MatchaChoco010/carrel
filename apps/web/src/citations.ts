/**
 * 本文の引用を、参考文献の節へのリンクにする。
 *
 * 飛び先を個々の文献ではなく節の先頭にするのは、変換器が返す参考文献が 1 項目
 * ずつに分かれているとは限らないためである。実測では 100 件近い文献が 3 つの
 * 塊になっており、項目へ飛ばすと塊の中の誤った位置へ着く。
 */

/** `[...]` のうち、年号を含むものだけを引用とみなす。 */
const CITATION = /\[([^\][]*\b(?:19|20)\d{2}[a-z]?[^\][]*)\]/g

const REFERENCES_HEADING = /^#{1,6}\s+(REFERENCES|References|参考文献)\s*$/m

export const REFERENCES_ID = 'references'

export function hasReferences(markdown: string): boolean {
  return REFERENCES_HEADING.test(markdown)
}

/** 参考文献の節が無ければ何もしない。飛び先の無いリンクを作らないため。 */
export function linkCitations(markdown: string): string {
  const at = markdown.search(REFERENCES_HEADING)
  if (at < 0) return markdown

  const body = markdown.slice(0, at)
  const tail = markdown.slice(at)

  const linked = body.replace(CITATION, (_whole, inner: string) => `[[${inner}]](#${REFERENCES_ID})`)
  // 目印は span で置く。a にすると本文のリンクと同じ扱いになり、描くときの
  // 差し替えで id が落ちて飛び先が消える。
  return `${linked}<span id="${REFERENCES_ID}"></span>\n\n${tail}`
}
