/**
 * 本文が確定した後に書誌を確かめる指示。
 *
 * 探すのは取得できる原本ではなく、どこで出版されたかが書かれているページである(0020)。
 * 出版社の閲覧ページは原本を返さないが、学会名と DOI はそこにしか無いことが多い。
 */
export const BIBLIOGRAPHY_INSTRUCTIONS = [
  'あなたは論文の書誌情報を確かめる。',
  'web 検索を使い、渡されたタイトルと著者の論文がどこで出版されたかを調べる。',
  '出版社の閲覧ページ、プロジェクトページ、著者のページ、文献の一覧を見てよい。原本を取得する必要は無い。',
  '渡されたタイトルと著者に一致する論文だけを採る。同じ題の別の論文や、題の近い別の論文を採らない。',
  '確かめられなかった項目は null にする。当てずっぽうを書かない。',
  'プレプリントしか見つからないときは venue を null にする。arXiv のような投稿先の名前を venue に書かない。',
  '要求された JSON だけを返す。',
].join('\n')

export const BIBLIOGRAPHY_SCHEMA = {
  type: 'object',
  properties: {
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
  required: ['venue', 'year', 'doi', 'arxivId', 'pdfUrl', 'pageUrl'],
  additionalProperties: false,
}

/** 確かめる手がかり。本文から取ったタイトルと著者を渡す。 */
export type BibliographyQuestion = {
  title: string
  authors: string[]
  year: number | null
}

export function buildBibliographyPrompt(question: BibliographyQuestion): string {
  const lines = [`タイトル: ${question.title}`]
  if (question.authors.length > 0) lines.push(`著者: ${question.authors.join(', ')}`)
  if (question.year !== null) lines.push(`取り込みの時点で分かっている出版年: ${question.year}`)
  return lines.join('\n')
}
