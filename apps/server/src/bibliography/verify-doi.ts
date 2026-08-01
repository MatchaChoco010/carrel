/**
 * 書誌が挙げた DOI が、その論文を指しているかを確かめる(#287)。
 *
 * DOI は出版物を一意に指す前提で使っている。同じ論文かどうかの突き合わせ(#245)は DOI を
 * 最初に見るので、誤った DOI は誤った重複を生む。
 *
 * 実際に、同じ予稿集の中の別の論文の番号が入ることがあった。組み立てられる形をしている
 * ので、当てずっぽうでも DOI らしく見えてしまう。
 */

/** 突き合わせのために題を均す。発音記号と記号の違いを落とす。 */
function fold(title: string): string[] {
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 2)
}

/**
 * 題がどれだけ重なるか。0 から 1。
 *
 * 副題の有無や記号の違いで語が数個外れるので、完全な一致は求めない。
 */
function overlap(asked: string, got: string): number {
  const want = [...new Set(fold(asked))]
  if (want.length === 0) return 0
  const have = new Set(fold(got))
  return want.filter((word) => have.has(word)).length / want.length
}

/**
 * 同じ論文と認める重なりの下限。
 *
 * 本番の 199 本で測ると、正しい組は 183 本すべてが 0.83 以上で、うち 181 本は 1.00
 * だった。別の文献を指していた 6 本は 0.14 以下である。間は空いているので、半分に置く。
 */
const MATCH_RATIO = 0.5

export type DoiLookup = (doi: string) => Promise<{ title: string } | null>

/**
 * DOI から書誌を引く。
 *
 * `doi.org` は登録機関を問わず解決する。content negotiation で書誌が JSON で返るので、
 * Crossref・DataCite・Eurographics のどれに登録されていても同じ経路で引ける。
 */
export const lookupDoi: DoiLookup = async (doi) => {
  const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
    headers: { accept: 'application/vnd.citationstyles.csl+json', 'user-agent': 'pct/0.1 (paper collection tool)' },
    redirect: 'follow',
  })
  if (!response.ok) return null
  const body = (await response.json()) as { title?: unknown }
  const title = typeof body.title === 'string' ? body.title : Array.isArray(body.title) ? body.title[0] : null
  return typeof title === 'string' && title.trim().length > 0 ? { title: title.trim() } : null
}

/**
 * その DOI をこの論文のものとして受け取ってよいか。
 *
 * 引けなかったときは受け取らない。どこも指さない DOI(桁を落としたものなど)を入れると、
 * 出所を辿れないうえ、後から誤りだと気づく手掛かりも無い。
 */
export async function doiPointsAtPaper(doi: string, title: string, lookup: DoiLookup): Promise<boolean> {
  let found: { title: string } | null
  try {
    found = await lookup(doi)
  } catch {
    return false
  }
  if (found === null) return false
  return overlap(title, found.title) >= MATCH_RATIO
}
