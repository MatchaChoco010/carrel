/**
 * 本文が確定した後に書誌を確かめる指示。
 *
 * 探すのは取得できる原本ではなく、どこで出版されたかが書かれているページである(0020)。
 * 出版社の閲覧ページは原本を返さないが、学会名と DOI はそこにしか無いことが多い。
 */
export const BIBLIOGRAPHY_INSTRUCTIONS = [
  'あなたは論文の書誌情報を確かめる。',
  '渡されるのは、その論文の本文の先頭である。',
  'まず、本文に書かれている標題と著者を読み取る。取り込みの時点で分かっている値が本文と違うときは、本文を正とする。',
  '著者は紙面の書式をそのまま写さない。全部を大文字にした表記は、通常の表記に直す。',
  '次に web 検索を使い、その論文がどこで出版されたかを調べる。',
  '出版社の閲覧ページ、プロジェクトページ、著者のページ、文献の一覧を見てよい。原本を取得する必要は無い。',
  '読み取った標題と著者に一致する論文だけを採る。同じ題の別の論文や、題の近い別の論文を採らない。',
  '確かめられなかった項目は null にする。当てずっぽうを書かない。',
  'プレプリントしか見つからないときは venue を null にする。arXiv のような投稿先の名前を venue に書かない。',
  '要求された JSON だけを返す。',
].join('\n')

export const BIBLIOGRAPHY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'], description: '本文に書かれている標題。読み取れなければ null。' },
    authors: { type: 'array', items: { type: 'string' }, description: '本文に書かれている著者。順序を保つ。' },
    venue: {
      type: ['string', 'null'],
      description: '学会名または雑誌名。巻・号・ページを添えてよい。プレプリントしか無いなら null。',
    },
    year: { type: ['integer', 'null'], description: '出版年。プレプリントしか無いならその投稿年。' },
    doi: { type: ['string', 'null'], description: '10. で始まる形。無ければ null。' },
    arxivId: { type: ['string', 'null'], description: 'arXiv の識別子。無ければ null。' },
    pdfUrl: { type: ['string', 'null'], description: '原本の PDF が置かれている場所。無ければ null。' },
    pageUrl: { type: ['string', 'null'], description: '根拠にしたページ。無ければ null。' },
  },
  required: ['title', 'authors', 'venue', 'year', 'doi', 'arxivId', 'pdfUrl', 'pageUrl'],
  additionalProperties: false,
}

/**
 * 確かめる手がかり。
 *
 * 本文の先頭を渡すのは、標題と著者を本文から取り直すためである(0020)。手元の PDF から
 * 入れた論文では、frontmatter の値が原本の先頭から読んだ暫定のものになる(0021)。
 */
export type BibliographyQuestion = {
  head: string
  title: string
  authors: string[]
  year: number | null
}

/** 本文のうち、標題と著者が収まる範囲。 */
export const HEAD_CHARS = 1500

export function buildBibliographyPrompt(question: BibliographyQuestion): string {
  const known = [`標題: ${question.title}`]
  if (question.authors.length > 0) known.push(`著者: ${question.authors.join(', ')}`)
  if (question.year !== null) known.push(`出版年: ${question.year}`)
  return [
    '取り込みの時点で分かっている値:',
    ...known,
    '',
    '本文の先頭:',
    question.head.slice(0, HEAD_CHARS),
  ].join('\n')
}
