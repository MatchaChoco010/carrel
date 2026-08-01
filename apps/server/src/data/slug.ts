import { createHash } from 'node:crypto'

export type SlugSource = {
  authors: string[]
  year: number | null
  /** 論文の題。語幹はここから作る。 */
  title: string
  /**
   * 規則が飛ばす語のうち、落とさずに拾う語(0023)。
   *
   * `von Mises-Fisher` の `von` のように、姓の前置きが固有名詞の一部であることがある。
   * 語の並びだけからは決まらないので、題を読んでいる取り込みの側が名指しする。名指しが
   * 無ければ規則どおりに飛ばす。語幹そのものは指せない。
   */
  keepWords?: string[]
  /** 語幹を作れないときのフォールバックに使う、その論文に固有の文字列。 */
  identity: string
}

/**
 * 語幹に入れない語。
 *
 * 冠詞・前置詞・接続詞は、どの論文の題にも出るので当たりを絞れない。動詞と代名詞は
 * 落とさない。`Attention Is All You Need` のように、それらが題の中身である場合がある。
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'with',
  'without',
  'using',
  'via',
  'in',
  'on',
  'to',
  'from',
  'by',
  'at',
  'as',
  'into',
  'onto',
  'over',
  'under',
  'between',
  'toward',
  'towards',
  'through',
  'during',
  'per',
  // 姓の前置き。単体では論文を絞れず、名前の途中で切れた語幹になる。
  'von',
  'van',
  'de',
  'der',
  'den',
  'di',
  'da',
  'du',
  'la',
  'le',
  'el',
])

/** コロンの前を略称として使う上限。`Mip-NeRF 360` のような形まで含める。 */
const SHORT_NAME_WORDS = 3
const SHORT_NAME_CHARS = 16

/** 語幹に入れる語の数と長さの上限。題の記憶から打って当たる程度に残す(0002)。 */
const MAX_WORDS = 5
const MAX_CHARS = 32

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

/** 語を上限まで詰める。上限を超える語はそこで打ち切る。 */
function pack(list: string[]): string {
  const taken: string[] = []
  for (const word of list) {
    if (taken.length >= MAX_WORDS) break
    const candidate = [...taken, word].join('-')
    if (candidate.length > MAX_CHARS) break
    taken.push(word)
  }
  return taken.join('-')
}

/**
 * 題から slug の語幹を作る(0002)。
 *
 * コロンより前が 2 語までなら、それを論文が与えた略称として使う(`NeRF: ...` → `nerf`)。
 * そうでなければ題の語を先頭から取る。冠詞や前置詞は飛ばすが、飛ばした結果 2 語に
 * 満たなくなるときは題をそのまま使う。`Attention Is All You Need` のような題で、
 * 元の題を思い出せない語幹になるのを避けるためである。
 */
export function keywordFromTitle(title: string, keepWords: string[] = []): string {
  const colon = title.indexOf(':')
  if (colon > 0) {
    const head = words(title.slice(0, colon))
    const joined = head.join('-')
    if (head.length > 0 && head.length <= SHORT_NAME_WORDS && joined.length <= SHORT_NAME_CHARS) return joined
  }

  const keep = new Set(keepWords.flatMap((word) => words(word)))
  const all = words(title)
  const content = all.filter((word) => !STOP_WORDS.has(word) || keep.has(word))
  return pack(content.length >= 2 ? content : all)
}

/** 名指しされた語のうち、題に出てくるものだけを残す(0023)。 */
export function wordsInTitle(keepWords: string[], title: string): string[] {
  const inTitle = new Set(words(title))
  return keepWords.filter((word) => words(word).every((part) => inTitle.has(part)))
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
  const keyword = keywordFromTitle(source.title, wordsInTitle(source.keepWords ?? [], source.title))

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
