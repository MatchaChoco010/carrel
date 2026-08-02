/** 突き合わせのために題を均す。大文字と小文字、空白、記号の違いを落とす。 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * 名前を、綴りの揺れを落とした形にする(#282)。
 *
 * 同じ人の名前が、出所によって `Schüßler` と `Schüssler` の両方で出てくる。発音記号を
 * 分解して落とし、`ß` は `ss` に開いて、どちらも同じ形にする。slug を作る側(0002)も
 * 同じ均し方をしている。
 */
function foldName(name: string): string {
  return name
    .replace(/\u00df/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * 著者の姓を取り出して均す。
 *
 * 出所によって `T. Müller` と `Thomas Müller` のように書き方が変わるので、姓だけを見る。
 */
export function familyName(name: string): string {
  const parts = foldName(name).split(' ').filter((part) => part.length > 0)
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

/** 突き合わせの相手。取り込み済みの論文と、まだ登録まで進んでいない取り込みの両方が入る。 */
export type Candidate = Identity & { slug: string }

/**
 * 同じ論文を引く(#245)。
 *
 * 出所の URL と arXiv の識別子だけでは、題名から入れた論文と URL から入れた論文が
 * 同じだと分からない。DOI が一致すれば同じ出版物であり、DOI が無い論文(arXiv など)
 * でも、題と筆頭著者が一致すれば同じ論文とみなす。ただし識別子が食い違う組は、
 * 版の違いとして別の論文のままにする。
 *
 * 相手には、途中で失敗した取り込みも含める(#263)。索引に載るのは登録まで進んだ論文
 * だけなので、索引だけを見ると失敗した取り込みと同じ論文に連番が付く。
 */
export function findSamePaper(candidates: Candidate[], asked: Identity): string | null {
  if (asked.doi !== null) {
    const byDoi = candidates.find((paper) => paper.doi === asked.doi)
    if (byDoi !== undefined) return byDoi.slug
  }

  const title = normalizeTitle(asked.title)
  if (title.length === 0) return null

  for (const paper of candidates) {
    if (normalizeTitle(paper.title) !== title) continue
    if (differentVersion(asked, paper)) continue
    // 著者が分からない側があるときは、題の一致だけで同じ論文とみなす。
    if (asked.authors.length === 0 || paper.authors.length === 0) return paper.slug
    if (sameFirstAuthor(asked.authors, paper.authors)) return paper.slug
  }
  return null
}
