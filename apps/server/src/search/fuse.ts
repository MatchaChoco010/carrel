/**
 * 全文検索とベクトル検索の順位を融合する。
 *
 * 全文検索が返すスコアとベクトル検索が返す距離は尺度が異なり、そのまま足し
 * 合わせても意味を持たない。どちらも「上位から何番目か」に落とせば比較できる
 * (0005)。
 */

/**
 * 順位を重みに変える定数。
 *
 * 小さいほど上位を強く優遇する。60 は Reciprocal Rank Fusion の慣例的な値で、
 * 上位 10 件ほどの差を保ちつつ、下位も完全には切り捨てない。
 */
export const RANK_CONSTANT = 60

export type Ranked = { id: number }

/**
 * 順位の逆数で足し合わせる。
 *
 * 両方の経路で上位に来たものが最終的にも上位に来る。片方の経路にしか現れない
 * ものも順位に応じて拾われる。
 */
export function fuseByRank(lists: Ranked[][]): { id: number; score: number }[] {
  const scores = new Map<number, number>()
  for (const list of lists) {
    list.forEach((item, position) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (RANK_CONSTANT + position + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
}
