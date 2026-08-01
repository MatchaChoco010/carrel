/** slug に使える文字。人間が読める形で、英小文字と数字と `-` からなる(0002)。 */
const SLUG_CHAR = /[a-z0-9-]/

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char)
}

export type SlugToken = {
  /** `@` の次から書き掛けの終わりまで。まだ何も打っていなければ空。 */
  text: string
  /** `@` の位置。 */
  start: number
  /** 書き掛けの終わり(カーソルの位置)。 */
  end: number
}

/**
 * カーソルの手前にある `@` の書き掛けを取り出す(#231)。
 *
 * 本文の途中でも補完を出すために、末尾かどうかではなく前後が空いているかで判じる。
 * `@` の前と、カーソルの後ろが、行の端か空白であれば書き掛けとみなす。語の途中に
 * 現れる `@`(メールアドレスなど)では出さない。
 */
export function slugTokenAt(value: string, caret: number): SlugToken | null {
  if (caret < 0 || caret > value.length) return null
  // カーソルの後ろが語の続きなら、いま書いている語ではない。
  if (!isSpace(value[caret])) return null

  let at = caret
  while (at > 0 && SLUG_CHAR.test(value[at - 1] as string)) at -= 1
  if (value[at - 1] !== '@') return null

  const start = at - 1
  if (!isSpace(value[start - 1])) return null
  return { text: value.slice(at, caret), start, end: caret }
}

/** 書き掛けを選んだ slug で置き換える。後ろに空白を 1 つ足し、カーソルはその後ろへ置く。 */
export function completeSlug(value: string, token: SlugToken, slug: string): { value: string; caret: number } {
  const inserted = `@${slug} `
  return {
    value: `${value.slice(0, token.start)}${inserted}${value.slice(token.end)}`,
    caret: token.start + inserted.length,
  }
}
