/**
 * LaTeX の区切りを `$` の形へ揃える。
 *
 * 描画に使う remark-math は `$...$` と `$$...$$` だけを数式として扱う。一方で
 * エージェントの応答は `\[...\]` と `\(...\)` で返ることがあり、そのままでは
 * 角括弧つきの生の LaTeX が本文に出る。
 *
 * コードのかたまりの中は変えない。そこに現れる `\[` は数式ではない。
 */

/** ``` または ~~~ で囲まれたかたまり。 */
const FENCE = /(^|\n)(```|~~~)[\s\S]*?(\n\2|$)/g

function convert(text: string): string {
  return text.replace(/\\\[([\s\S]*?)\\\]/g, (_whole, body: string) => `$$${body}$$`).replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_whole, body: string) => `$${body}$`,
  )
}

export function normalizeMathDelimiters(markdown: string): string {
  const parts: string[] = []
  let at = 0
  for (const fence of markdown.matchAll(FENCE)) {
    const start = fence.index ?? 0
    parts.push(convert(markdown.slice(at, start)), fence[0] as string)
    at = start + (fence[0] as string).length
  }
  parts.push(convert(markdown.slice(at)))
  return parts.join('')
}
