/**
 * 本文の冒頭にある、frontmatter と重なる部分を落とす。
 *
 * 変換器は紙面をそのまま写すので、本文の先頭に題・著者・所属・連絡先・著作権
 * 表示が並ぶ。これらは frontmatter が正の情報として持っており(0002)、画面でも
 * frontmatter から出しているので、本文にも同じ内容が非構造の段落として重複する。
 *
 * 本文のファイル自体には手を入れない。0002 は markdown を正としており、pct が
 * 無い環境でも読めることを要件にしているので、紙面にあるものを消す判断は表示の
 * 側でだけ行う。
 */

/** ここまでに現れたら、以降は本文とみなす見出し。 */
const BODY_START = /^#{1,6}\s+(?:\d+[.\s]|[IVX]+[.\s]|1\s|abstract|introduction|はじめに|序論)/im

/** 冒頭のうち、落としてよいと判じる行。 */
const DROPPABLE = [
  // 題。変換器が題を見出しにするので、見出しの印ごと落とす。
  /^#\s/,
  // 書誌の項目は見出しとして組まれることがある。印を除いてから判じる。
  // 著者と所属。紙面では姓名が大文字で組まれる。和訳でも姓名はそのまま残り、
  // 区切りだけが読点になる。
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
