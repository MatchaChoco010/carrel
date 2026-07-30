import type { Bbox, ConvertedBlock, ConvertedFigure } from './types.ts'

/**
 * 図の下にキャプションが来るとみなす隙間の上限。
 *
 * 実測では 3 から 11 ポイントだった。行間 2 行ぶんまでを同じ図の説明とみなす。
 */
const CAPTION_GAP = 40

/** 図とキャプションが同じ段にあるとみなす、横方向の重なりの割合。 */
const OVERLAP_RATIO = 0.5

function overlaps(figure: Bbox, caption: Bbox): boolean {
  const width = Math.min(figure.x1, caption.x1) - Math.max(figure.x0, caption.x0)
  if (width <= 0) return false
  const narrower = Math.min(figure.x1 - figure.x0, caption.x1 - caption.x0)
  return narrower > 0 && width / narrower >= OVERLAP_RATIO
}

/** 図が他の図の内側にあるか。多段の図の小図はキャプションを持たない。 */
function insideAnother(figure: ConvertedBlock, figures: ConvertedBlock[]): boolean {
  return figures.some(
    (other) =>
      other.id !== figure.id &&
      other.page === figure.page &&
      other.bbox.x0 <= figure.bbox.x0 &&
      other.bbox.y0 <= figure.bbox.y0 &&
      other.bbox.x1 >= figure.bbox.x1 &&
      other.bbox.y1 >= figure.bbox.y1,
  )
}

/**
 * 図とキャプションを組にする。
 *
 * 対応づけは紙面上の位置で決める。キャプションは図のすぐ下に、同じ段の幅で置かれる。
 * 変換器も図とキャプションをまとめた組を返すが、その組は 1 つの中へ複数の図と
 * キャプションを入れることがあり、どのキャプションがどの図のものかを表さない。
 * そのため組は、隙間が同じ候補が並んだときの優先にだけ使う。
 */
export function buildFigures(blocks: ConvertedBlock[]): ConvertedFigure[] {
  const all = blocks.filter((b) => b.kind === 'figure' && b.image !== null)
  const captions = blocks.filter((b) => b.kind === 'caption')
  // 他の図の内側にある小図は、固有のキャプションを持たない。
  const figures = all.filter((f) => !insideAnother(f, all))

  const candidates: { figure: ConvertedBlock; caption: ConvertedBlock; gap: number; sameGroup: boolean }[] = []
  for (const figure of figures) {
    for (const caption of captions) {
      if (caption.page !== figure.page) continue
      const gap = caption.bbox.y0 - figure.bbox.y1
      if (gap < 0 || gap > CAPTION_GAP) continue
      if (!overlaps(figure.bbox, caption.bbox)) continue
      candidates.push({
        figure,
        caption,
        gap,
        sameGroup: figure.groupId !== null && figure.groupId === caption.groupId,
      })
    }
  }
  // 隙間の小さい組から確定させる。同じ図に複数のキャプションが近いとき、
  // 近いほうが先に取る。
  candidates.sort((a, b) => a.gap - b.gap || Number(b.sameGroup) - Number(a.sameGroup))

  const captionOf = new Map<string, ConvertedBlock>()
  const usedCaptions = new Set<string>()
  for (const { figure, caption } of candidates) {
    if (captionOf.has(figure.id) || usedCaptions.has(caption.id)) continue
    captionOf.set(figure.id, caption)
    usedCaptions.add(caption.id)
  }

  return all
    .map((figure) => ({
      blockId: figure.id,
      page: figure.page,
      image: figure.image as string,
      caption: captionOf.get(figure.id)?.markdown ?? '',
    }))
    .sort((a, b) => a.page - b.page || a.blockId.localeCompare(b.blockId))
}
