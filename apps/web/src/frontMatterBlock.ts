/**
 * 本文の冒頭にある、frontmatter と重なる部分を落とす。
 *
 * 落とすのは表示のときだけで、本文のファイルには手を入れない。
 */

const BODY_START = /^#{1,6}\s+(?:\d+[.\s]|[IVX]+[.\s]|1\s|abstract|introduction|はじめに|序論)/im

const DROPPABLE = [
  /^#\s/, // 題
  // 著者と所属。姓名は和訳でもそのまま残り、区切りだけが読点になる。
  /^[A-ZÀ-Ý][A-ZÀ-Ý\s.'-]+\s*[∗*†]?\s*[,、]/,
  /^authors['’]?\s+addresses/i,
  /^permission to make digital/i,
  /^publication rights licensed/i,
  /^©\s*\d{4}/,
  /^\d{4}-\d{4}\/\d{4}/, // ACM の書誌の番号
  /^https:\/\/doi\.org\//,
  /^ccs concepts/i,
  /^ccs\s*概念/i,
  /^追加のキーワード/,
  /^acm\s*参照形式/,
  /^出版権/,
  /^著者の住所/,
  /^両著者は/,
  /^additional key words/i,
  /^acm reference format/i,
  /^\*?both authors contributed/i,
]

/**
 * 本文の先頭から、frontmatter と重なる部分を落とす。
 *
 * 落とす範囲は最初の節の見出しまでに限る。見出しが見つからない場合は何も落と
 * さない。誤って本文を削るより、重複が残るほうが害が小さい。
 */
export function stripFrontMatterBlock(markdown: string): string {
  const at = markdown.search(BODY_START)
  if (at <= 0) return markdown

  const head = markdown.slice(0, at)
  const rest = markdown.slice(at)
  const kept = head
    .split(/\n{2,}/)
    .filter((block) => {
      const text = block.trim()
      if (text.length === 0) return false
      if (/^#{1,6}\s/.test(text) && !/^#\s/.test(text)) {
        // 見出しとして組まれた書誌の項目。印を外した中身で判じる。
        const inner = text.replace(/^#{1,6}\s+/, '')
        return !DROPPABLE.some((pattern) => pattern.test(inner))
      }
      return !DROPPABLE.some((pattern) => pattern.test(text))
    })
    .join('\n\n')

  return kept.trim().length === 0 ? rest : `${kept.trim()}\n\n${rest}`
}
