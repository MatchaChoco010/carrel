/**
 * 番号つきの見出しの階層を、番号の深さに合わせる。
 *
 * 変換器は見出しの階層を字の大きさから推し量るので、同じ深さの節が別の階層で出る。
 * 節の番号は深さをそのまま表しているため、番号があるものは番号から決められる。
 */

/** 見出しの行。番号があれば 2 番目の組で取る。 */
const HEADING = /^(#{1,6}) +(\d+(?:\.\d+)*)(\s+\S.*)$/

/** 論文の題が `#` なので、いちばん外側の節は `##` から始める。 */
const TITLE_LEVEL = 1

const MAX_LEVEL = 6

export type LevelResult = {
  markdown: string
  /** 階層を変えた見出しの数。記録に残す。 */
  releveled: number
}

export function normalizeHeadingLevels(markdown: string): LevelResult {
  const lines = markdown.split('\n')
  const out: string[] = []
  let releveled = 0
  let fence: string | null = null

  for (const line of lines) {
    const opener = /^(\s*)(`{3,}|~{3,})/.exec(line)
    if (fence === null && opener !== null) {
      fence = opener[2] as string
      out.push(line)
      continue
    }
    // コードブロックの中の `#` は見出しではない。
    if (fence !== null) {
      if (opener !== null && (opener[2] as string).startsWith(fence[0] as string)) fence = null
      out.push(line)
      continue
    }

    const heading = HEADING.exec(line)
    if (heading === null) {
      out.push(line)
      continue
    }

    const number = heading[2] as string
    const want = Math.min(MAX_LEVEL, TITLE_LEVEL + number.split('.').length)
    if ((heading[1] as string).length === want) {
      out.push(line)
      continue
    }
    out.push(`${'#'.repeat(want)} ${number}${heading[3] as string}`)
    releveled += 1
  }

  return { markdown: out.join('\n'), releveled }
}
