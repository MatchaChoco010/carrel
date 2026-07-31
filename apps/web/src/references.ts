/**
 * 本文の参考文献の節を切り出す。
 *
 * 見出しの当て方は、参考文献を 1 件ずつに直す段階と揃える(0015)。揃えないと、
 * 段階が読んだ節と画面が差し替える節がずれる。
 */
const HEADING = /^#{1,6}\s+(?:\d+[.)]?\s+)?(references?|参考文献|文献|bibliography)\s*$/im
const NEXT_HEADING = /^#{1,6}\s+/m

export type BodySplit = {
  /** 参考文献の見出しまで(見出しを含む)。 */
  before: string
  /** 次の見出しから後ろ。無ければ空。 */
  after: string
}

/** 参考文献の節が無ければ null を返す。 */
export function splitAtReferences(markdown: string): BodySplit | null {
  const heading = HEADING.exec(markdown)
  if (heading === null) return null

  const headingEnd = heading.index + heading[0].length
  const rest = markdown.slice(headingEnd)
  const next = NEXT_HEADING.exec(rest)

  return {
    before: markdown.slice(0, headingEnd),
    after: next === null ? '' : rest.slice(next.index),
  }
}
