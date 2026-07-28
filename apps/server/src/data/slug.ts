import { createHash } from 'node:crypto'

export type SlugSource = {
  authors: string[]
  year: number | null
  /** 論文の略称、または本文から取れる短い語。 */
  keyword: string | null
  /** 語幹を作れないときのフォールバックに使う、その論文に固有の文字列。 */
  identity: string
}

/** 姓を ASCII の小文字に落とす。合成済みの発音記号は分解して取り除く。 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * 著者名から姓を取り出す。
 *
 * `Ben Mildenhall` と `Mildenhall, Ben` の両方が来るため、カンマの有無で
 * どちらの並びかを判定する。
 */
export function lastNameOf(author: string): string {
  const trimmed = author.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.includes(',')) {
    return normalizeName(trimmed.split(',')[0] ?? '')
  }
  const parts = trimmed.split(/\s+/)
  return normalizeName(parts[parts.length - 1] ?? '')
}

function words(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
}

/**
 * slug の語幹を作る。
 *
 * タイトルをそのまま渡された場合に備えて、コロンより前が 2 語までならそちらを
 * 使う。`NeRF: Representing Scenes as ...` のように、略称をコロンの前に置く
 * 書き方が多いため。
 */
export function normalizeKeyword(keyword: string): string {
  const colon = keyword.indexOf(':')
  if (colon > 0) {
    const head = words(keyword.slice(0, colon))
    if (head.length > 0 && head.length <= 2) return head.join('-')
  }
  return words(keyword).slice(0, 3).join('-')
}

function shortHash(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 8)
}

/** 衝突の判定に使う。既に使われている slug なら true を返す。 */
export type SlugTaken = (candidate: string) => boolean

export function buildSlug(source: SlugSource, isTaken: SlugTaken): string {
  const base = baseSlug(source)
  if (!isTaken(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!isTaken(candidate)) return candidate
  }
  return `${base}-${shortHash(source.identity)}`
}

function baseSlug(source: SlugSource): string {
  const lastName = source.authors.map(lastNameOf).find((name) => name.length > 0) ?? ''
  const year = source.year !== null && Number.isInteger(source.year) ? String(source.year) : ''
  const keyword = source.keyword !== null ? normalizeKeyword(source.keyword) : ''

  if (lastName.length === 0 || year.length === 0) {
    return `unknown${year.length > 0 ? year : '0000'}-${shortHash(source.identity)}`
  }
  if (keyword.length === 0) {
    return `${lastName}${year}-${shortHash(source.identity).slice(0, 4)}`
  }
  return `${lastName}${year}-${keyword}`
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * ディレクトリ名として読み取った slug が扱える形かを確かめる。
 *
 * `$PCT_DATA` は人が触るので、想定外の名前のディレクトリが混ざりうる。
 */
export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= 120 && SLUG_PATTERN.test(value)
}
