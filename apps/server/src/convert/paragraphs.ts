/**
 * 段の折り返しとページの切り替わりで割れた段落を繋ぐ。
 *
 * 変換器は紙面のブロックごとに markdown を返すので、1 つの文が段や紙面の境目で
 * 2 つの段落に分かれる。照合はページ単位で走り、段落の分け方には触れないので、
 * ページを繋いだ後に直す。
 */

/** 繋ぐ相手にしない段落。見出し・図・表・数式・箇条書き・引用・脚注。 */
const STRUCTURAL = /^(#|!\[|<|\||\$\$|```|>|-\s|\*\s|\d+\.\s|\[\^?\d)/

/** 文の終わりに見える末尾。 */
const SENTENCE_END = /[.!?:;)\]}"'’”%]$/

/** 続きに見える先頭。 */
const CONTINUES = /^[a-z(\[]/

/** 行末のハイフン。 */
const BROKEN_WORD = /[-‐‑]$/

function isStructural(block: string): boolean {
  return STRUCTURAL.test(block)
}

type Join = {
  /** 段落の間に入れる文字。 */
  glue: string
  /** 前の段落の末尾のハイフンを落とすか。 */
  dropHyphen: boolean
}

/**
 * 2 つの段落を繋ぐかを決める。
 *
 * 末尾のハイフンは、次が小文字なら行末で割れた語なので落とし、大文字なら
 * `Fridovich-Keil` のような元からのハイフンなので残す。
 */
function joiner(previous: string, next: string): Join | null {
  if (isStructural(previous) || isStructural(next)) return null
  if (BROKEN_WORD.test(previous)) {
    if (/^[a-z]/.test(next)) return { glue: '', dropHyphen: true }
    return /^[A-Z]/.test(next) ? { glue: '', dropHyphen: false } : null
  }
  if (SENTENCE_END.test(previous)) return null
  return CONTINUES.test(next) ? { glue: ' ', dropHyphen: false } : null
}

export type JoinResult = {
  markdown: string
  /** 繋いだ箇所の数。記録に残す。 */
  joined: number
}

export function joinSplitParagraphs(markdown: string): JoinResult {
  const blocks = markdown.split(/\n{2,}/).map((b) => b.trim())
  const out: string[] = []
  let joined = 0

  for (const block of blocks) {
    if (block.length === 0) continue
    const previous = out[out.length - 1]
    const how = previous === undefined ? null : joiner(previous, block)
    if (previous === undefined || how === null) {
      out.push(block)
      continue
    }
    const head = how.dropHyphen ? previous.replace(BROKEN_WORD, '') : previous
    out[out.length - 1] = `${head}${how.glue}${block}`
    joined += 1
  }

  return { markdown: out.join('\n\n'), joined }
}
