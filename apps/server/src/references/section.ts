// 参考文献の節の見出しは、原文の言語と出版元で変わる。番号や記号が前に付く形も拾う。
const HEADING = /^#{1,6}\s+(?:\d+[.)]?\s+)?(references?|参考文献|文献|bibliography)\s*$/i
const NEXT_HEADING = /^#{1,6}\s+/

/**
 * `paper.md` から参考文献の節を取り出す。見出しから次の見出しまでを返す。
 *
 * 節が無ければ null を返す。取り込んだ論文が参考文献を持たないことはありうるので、
 * これは失敗ではない。
 */
export function referencesSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  const at = lines.findIndex((line) => HEADING.test(line.trim()))
  if (at < 0) return null

  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => NEXT_HEADING.test(line))
  const section = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
  return section.length === 0 ? null : section
}
