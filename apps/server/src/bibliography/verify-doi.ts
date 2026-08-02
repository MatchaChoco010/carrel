/**
 * 書誌が挙げた DOI が、その論文を指しているかを確かめる(#287)。
 *
 * DOI は出版物を一意に指す前提で使っている。同じ論文かどうかの突き合わせ(#245)は DOI を
 * 最初に見るので、誤った DOI は誤った重複を生む。
 *
 * 実際に、同じ予稿集の中の別の論文の番号が入ることがあった。組み立てられる形をしている
 * ので、当てずっぽうでも DOI らしく見えてしまう。
 */

/** DOI の登録内容。指す先が本当にこの論文かを判断する材料になる。 */
export type DoiRecord = {
  title: string
  authors: string[]
  year: number | null
  /** 収録先の名前。予稿集や雑誌の名前が入る。 */
  container: string | null
}

export type DoiLookup = (doi: string) => Promise<DoiRecord | null>

/** 登録内容がこの論文のものかを答える。 */
export type DoiJudge = (record: DoiRecord) => Promise<boolean>

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** CSL JSON の著者は姓名が分かれている。表示に使う 1 本の文字列へ戻す。 */
function authorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const literal = asString(e['literal'])
    if (literal !== null) {
      names.push(literal)
      continue
    }
    const given = asString(e['given'])
    const family = asString(e['family'])
    const joined = [given, family].filter((part) => part !== null).join(' ')
    if (joined.length > 0) names.push(joined)
  }
  return names
}

/** CSL JSON の日付は `date-parts` に年から順で入る。 */
function issuedYear(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const parts = (value as Record<string, unknown>)['date-parts']
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null
  const year = (parts[0] as unknown[])[0]
  return typeof year === 'number' && Number.isInteger(year) ? year : null
}

/** CSL JSON から、判断に使う項目だけを取り出す。 */
export function parseDoiRecord(body: unknown): DoiRecord | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const raw = Array.isArray(b['title']) ? b['title'][0] : b['title']
  const title = asString(raw)
  if (title === null) return null
  return {
    title,
    authors: authorNames(b['author']),
    year: issuedYear(b['issued']),
    container: asString(Array.isArray(b['container-title']) ? b['container-title'][0] : b['container-title']),
  }
}

/**
 * DOI から登録内容を引く。
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
  return parseDoiRecord(await response.json())
}

/**
 * その DOI をこの論文のものとして受け取ってよいか。
 *
 * 引けなかったときと判断がつかなかったときは受け取らない。DOI は無くても論文は読めるが、
 * 誤った DOI は別の論文と同一視される。取りこぼすほうの間違いを選ぶ。
 */
export async function doiPointsAtPaper(doi: string, lookup: DoiLookup, judge: DoiJudge): Promise<boolean> {
  let record: DoiRecord | null
  try {
    record = await lookup(doi)
  } catch {
    return false
  }
  // どこも指さない DOI は捨てる。出所を辿れないうえ、後から誤りだと気づく手掛かりも無い。
  if (record === null) return false
  try {
    return await judge(record)
  } catch {
    return false
  }
}
