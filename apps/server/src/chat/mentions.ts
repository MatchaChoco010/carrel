import { paperDir } from '../data/layout.ts'

/** `@slug` の表記。slug は英数字とハイフンだけからなる(0002)。 */
const MENTION = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g

/** 書かれた順に、重複なく返す。 */
export function findMentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[1] as string))]
}

/**
 * エージェントへ渡す形へ展開する。展開はこの返り値の中だけに閉じ、記録は元の表記のまま。
 *
 * コレクションに無い slug は展開しない。存在しないファイルを探させないためである。
 */
export function expandMentions(text: string, dataDir: string, known: (slug: string) => boolean): string {
  return text.replace(MENTION, (whole, slug: string) =>
    known(slug) ? `${whole}(${paperDir(dataDir, slug)}/)` : `${whole}(コレクションに無い)`,
  )
}
