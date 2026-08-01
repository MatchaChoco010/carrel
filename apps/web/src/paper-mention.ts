import type { PaperIndexEntry } from './api.ts'

/**
 * チャットの本文に出す論文の参照 1 件(0024)。
 *
 * `name` が本文に出る短い形で、残りはツールチップに出す。
 */
export type Mention = {
  slug: string
  /** `Wang 2026a` の形。同じ姓と年が重ならなければ字は付かない。 */
  name: string
  title: string
  authors: string[]
  year: number | null
}

/** 著者と年が取れなかった論文に付く姓(0002)。短くしても読めるものにならない。 */
const FALLBACK_NAME = 'unknown'

const PREFIX = /^([a-z]+)(\d{4})$/

/**
 * slug の先頭から姓と年を読む(0024)。
 *
 * 索引の著者名から姓を取り直すと、slug を付けたときの判断と二重になる。slug は
 * その結果を持っているので、こちらから読む。
 */
export function prefixOf(slug: string): { name: string; year: string } | null {
  const head = slug.split('-')[0] ?? ''
  const matched = PREFIX.exec(head)
  if (matched === null) return null
  const [, name, year] = matched as unknown as [string, string, string]
  if (name === FALLBACK_NAME) return null
  return { name, year }
}

/** 0 から `a`、`b`、…、`z`、`aa` と続く字。 */
function letterAt(index: number): string {
  let rest = index
  let out = ''
  for (;;) {
    out = String.fromCharCode(97 + (rest % 26)) + out
    rest = Math.floor(rest / 26) - 1
    if (rest < 0) return out
  }
}

/**
 * 索引から、slug ごとの参照の見え方を作る(0024)。
 *
 * 同じ姓と年の論文が重なったときだけ字を足す。字はコレクションに入れた順に振る
 * ので、後から取り込んでも既に付いた字が動かない。並びは索引の口が返す順(追加日、
 * 同着は slug の綴り順)である。
 */
export function mentionsOf(papers: PaperIndexEntry[]): Map<string, Mention> {
  const groups = new Map<string, PaperIndexEntry[]>()
  for (const paper of papers) {
    const prefix = prefixOf(paper.slug)
    if (prefix === null) continue
    const key = `${prefix.name}${prefix.year}`
    const list = groups.get(key) ?? []
    list.push(paper)
    groups.set(key, list)
  }

  const mentions = new Map<string, Mention>()
  for (const list of groups.values()) {
    list.forEach((paper, index) => {
      const prefix = prefixOf(paper.slug)
      if (prefix === null) return
      const surname = prefix.name.charAt(0).toUpperCase() + prefix.name.slice(1)
      const letter = list.length > 1 ? letterAt(index) : ''
      mentions.set(paper.slug, {
        slug: paper.slug,
        name: `${surname} ${prefix.year}${letter}`,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
      })
    })
  }
  return mentions
}

/** ツールチップに出す著者の行。筆頭著者だけを出し、他がいることは「ほか」で示す。 */
export function authorLine(mention: Mention): string {
  const lead = mention.authors[0]
  const who = lead === undefined ? '著者不明' : mention.authors.length > 1 ? `${lead} ほか` : lead
  return mention.year === null ? who : `${who}, ${mention.year}`
}
