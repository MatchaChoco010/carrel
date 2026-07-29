/**
 * 文字層と変換結果の差を取る。
 *
 * 見るのは「文字層にあって変換結果に無い文字」の量である。
 * 語を単位にすると 1 文字の変数名の欠落を見落とすため、文字を単位にする(0009)。
 */

/** 差の計算から外す文字。組版由来で、変換結果に現れないのが正常なもの。 */
const IGNORED = new Set([...' \t\r\n ​-‐‑‒–—−'])

/** 変換器が文字を出せなかったことを表す文字。 */
export const REPLACEMENT = '�'

/**
 * 数式用の英数字を、対応する普通の英数字へ均す。
 *
 * 文字層は数式の変数を基本多言語面の外にある数式用の字(`𝑀` は U+1D440)で持つ
 * が、変換結果は LaTeX の中で普通の `M` として書く。均さないと、正しく変換
 * できている数式がまるごと欠落として数えられる。
 */
function normalize(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  if (code < 0x1d400 || code > 0x1d7ff) return ch
  const folded = ch.normalize('NFKC')
  return folded.length > 0 ? folded : ch
}

export type TextGap = {
  /** 文字層にあって変換結果に無い文字の延べ数。 */
  lost: number
  /** 文字層の文字の延べ数。 */
  total: number
  /** 変換結果に含まれる、文字を出せなかった印の数。 */
  replacements: number
  /** 欠けた文字の種類。多い順に最大 12 種。 */
  samples: string[]
}

function countChars(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of text) {
    if (IGNORED.has(raw)) continue
    const ch = normalize(raw)
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  return counts
}

/**
 * 文字層と変換結果を突き合わせ、欠けた文字を数える。
 *
 * 文字の並びではなく出現数で比べる。変換器は読み順を直したり行末のハイフンで
 * 分割された語を結合したりするので、並びの一致は求められない。
 */
export function textGap(layer: string, converted: string): TextGap {
  const want = countChars(layer)
  const got = countChars(converted)

  let lost = 0
  let total = 0
  const missing: [string, number][] = []
  for (const [ch, n] of want) {
    total += n
    const short = n - (got.get(ch) ?? 0)
    if (short > 0) {
      lost += short
      missing.push([ch, short])
    }
  }
  missing.sort((a, b) => b[1] - a[1])
  return {
    lost,
    total,
    replacements: got.get(REPLACEMENT) ?? 0,
    samples: missing.slice(0, 12).map(([ch]) => ch),
  }
}

/**
 * そのページを照合で重点的に見るかどうか(0009)。
 *
 * 差がゼロでないこと自体は異常ではない。変換器はページ番号やヘッダーを本文から
 * 分けるため、一致しないのが正常である。重点的に見るページを選ぶ手がかりとして
 * 使い、品質の点数としては扱わない。
 *
 * 変換結果に文字を出せなかった印があれば、量にかかわらず重点的に見る。
 * その印は、変換器が文字を落としたことを直接に示すからである。
 */
export const FOCUS_LOST_RATIO = 0.05

export function needsFocus(gap: TextGap): boolean {
  if (gap.replacements > 0) return true
  return gap.total > 0 && gap.lost / gap.total >= FOCUS_LOST_RATIO
}
