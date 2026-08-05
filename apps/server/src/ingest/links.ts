/** ページを見に行くときの上限。数が増えるほど取り込みの待ちが伸びる。 */
export const SCAN_PAGES = 3

/** 1 つのページから拾う PDF の数の上限。 */
export const SCAN_LINKS = 5

/**
 * ページの中の PDF への直リンクを拾う(#243)。
 *
 * プロジェクトページや所属機関の閲覧ページは、PDF を相対のリンクで置いていることが多い。
 * 指されたページを開かずに探すと、この置き場に辿り着けない。
 */
export function pdfLinksIn(html: string, pageUrl: string): string[] {
  const links = new Set<string>()
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    const href = match[1]
    if (href === undefined) continue
    try {
      links.add(new URL(href, pageUrl).toString())
    } catch {
      // 解けない書き方は捨てる。
    }
    if (links.size >= SCAN_LINKS) break
  }
  return [...links]
}

/** ページから読み取れたもの。解決の手がかりにする(#243)。 */
export type PageHint = {
  url: string
  /** `<title>` か最初の見出し。 */
  title: string | null
  pdfLinks: string[]
}

function textOf(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  const text = match?.[1]?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text === undefined || text.length === 0 ? null : text
}

/**
 * 指されたページを開いて、標題と PDF へのリンクを読む。
 *
 * 開かずに URL の文字だけで探すと、似た題の別の論文に行き着くことがある(#243)。
 */
export async function readPageHint(url: string): Promise<PageHint | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'carrel/0.1 (https://github.com/MatchaChoco010/carrel)' },
    })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').includes('html')) return null
    const html = await response.text()
    return {
      url: response.url,
      title: textOf(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      pdfLinks: pdfLinksIn(html, response.url),
    }
  } catch {
    return null
  }
}

/** 見に行けるページから PDF の直リンクを集める。 */
export async function scanForPdfLinks(pages: string[]): Promise<string[]> {
  const found: string[] = []
  for (const page of pages.slice(0, SCAN_PAGES)) {
    const hint = await readPageHint(page)
    if (hint !== null) found.push(...hint.pdfLinks)
  }
  return [...new Set(found)]
}
