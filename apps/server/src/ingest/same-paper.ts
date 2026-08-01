import type { IndexDb } from '../db/index-db.ts'

/** 突き合わせのために題を均す。大文字と小文字、空白、記号の違いを落とす。 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * 著者の姓を取り出して均す。
 *
 * 出所によって `T. Müller` と `Thomas Müller` のように書き方が変わるので、姓だけを見る。
 */
export function familyName(name: string): string {
  const parts = normalizeTitle(name).split(' ').filter((part) => part.length > 0)
  return parts.at(-1) ?? ''
}

/** 筆頭著者の姓が同じかどうか。どちらかが著者を持たなければ判じない。 */
export function sameFirstAuthor(a: string[], b: string[]): boolean {
  const one = familyName(a[0] ?? '')
  const other = familyName(b[0] ?? '')
  return one.length > 0 && one === other
}

/** 取り込もうとしている論文の見分けがつく情報。 */
export type Identity = {
  title: string
  authors: string[]
  doi: string | null
  arxivId: string | null
}

/**
 * 版が違うと分かるか(0004)。
 *
 * プレプリントと会議版は題も著者も同じだが、別の論文として扱う。どちらも識別子を
 * 持っていて、それが食い違うときだけ「別の版」と判じられる。
 */
function differentVersion(a: Identity, b: Identity): boolean {
  if (a.doi !== null && b.doi !== null && a.doi !== b.doi) return true
  if (a.arxivId !== null && b.arxivId !== null && a.arxivId !== b.arxivId) return true
  return false
}

/**
 * 既に取り込んである同じ論文を引く(#245)。
 *
 * 出所の URL と arXiv の識別子だけでは、題名から入れた論文と URL から入れた論文が
 * 同じだと分からない。DOI が一致すれば同じ出版物であり、DOI が無い論文(arXiv など)
 * でも、題と筆頭著者が一致すれば同じ論文とみなす。ただし識別子が食い違う組は、
 * 版の違いとして別の論文のままにする。
 */
export function findSamePaper(index: IndexDb, asked: Identity): string | null {
  if (asked.doi !== null) {
    const byDoi = index.findByDoi(asked.doi)
    if (byDoi !== null) return byDoi
  }

  const title = normalizeTitle(asked.title)
  if (title.length === 0) return null

  for (const paper of index.identities()) {
    if (normalizeTitle(paper.title) !== title) continue
    const known: Identity = { title: paper.title, authors: paper.authors, doi: paper.doi, arxivId: paper.arxivId }
    if (differentVersion(asked, known)) continue
    // 著者が分からない側があるときは、題の一致だけで同じ論文とみなす。
    if (asked.authors.length === 0 || known.authors.length === 0) return paper.slug
    if (sameFirstAuthor(asked.authors, known.authors)) return paper.slug
  }
  return null
}
