/**
 * 本文を見出し単位に分ける。
 *
 * 1 回の要求で論文全体を訳すと、長い論文で出力が上限に達し、途中で切れたときに
 * どこから続ければよいか決められない(0004)。
 */

export type Section = {
  /** 0 から始まる通し番号。失敗した部分だけを再要求するのに使う。 */
  index: number
  /** 見出しの深さ。見出しの前にある文章は 0。 */
  level: number
  /** 見出しの行。見出しの前にある文章では空。 */
  heading: string
  /** 見出しを含む、その節の markdown 全体。 */
  markdown: string
}

const HEADING = /^(#{1,6})\s+(.*)$/

/**
 * 見出しの行かどうか。
 *
 * コードブロックの中の `#` は見出しではない。論文には擬似コードやシェルの例が
 * あり、行頭の `#` が注釈として現れる。
 */
function splitLines(markdown: string): { line: string; inCode: boolean }[] {
  const out: { line: string; inCode: boolean }[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const opener = /^(\s*)(`{3,}|~{3,})/.exec(line)
    if (fence === null && opener !== null) {
      fence = opener[2] as string
      out.push({ line, inCode: true })
      continue
    }
    if (fence !== null) {
      out.push({ line, inCode: true })
      if (opener !== null && (opener[2] as string).startsWith(fence[0] as string)) fence = null
      continue
    }
    out.push({ line, inCode: false })
  }
  return out
}

export function splitSections(markdown: string): Section[] {
  const lines = splitLines(markdown)
  const sections: Section[] = []
  let current: { level: number; heading: string; lines: string[] } | null = null

  const flush = (): void => {
    if (current === null) return
    const text = current.lines.join('\n').trim()
    if (text.length > 0) {
      sections.push({
        index: sections.length,
        level: current.level,
        heading: current.heading,
        markdown: text,
      })
    }
    current = null
  }

  for (const { line, inCode } of lines) {
    const m = inCode ? null : HEADING.exec(line)
    if (m !== null) {
      flush()
      current = { level: (m[1] as string).length, heading: line, lines: [line] }
      continue
    }
    if (current === null) current = { level: 0, heading: '', lines: [] }
    current.lines.push(line)
  }
  flush()

  return sections
}

/** 訳した節を並べ直して 1 つの markdown にする。 */
export function joinSections(parts: string[]): string {
  return `${parts.map((p) => p.trim()).filter((p) => p.length > 0).join('\n\n')}\n`
}
