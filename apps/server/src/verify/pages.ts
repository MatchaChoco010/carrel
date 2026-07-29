import { bodyBlocks, buildPages } from '../convert/document.ts'
import type { ConvertedDocument } from '../convert/types.ts'
import { needsFocus, textGap, type TextGap } from './diff.ts'
import { IMAGE_LINE, type VerifyPageInput } from './prompt.ts'
import type { TextLayer } from './textlayer.ts'

export type PageWork = {
  page: number
  input: VerifyPageInput
  /** そのページの欠落。照合の後に同じ測り方で比べる。 */
  gap: TextGap
}

/**
 * 照合の要求を 1 ページずつ組み立てる。
 *
 * 文字層はブロックの領域から引いたものを連ね、引けなかった箇所はページ全体の
 * 文字層で補う(0009)。
 */
export function buildPageWork(
  document: ConvertedDocument,
  layer: TextLayer,
  assetsDirName: string,
): PageWork[] {
  const body = bodyBlocks(document)
  const bodyByPage = groupByPage(body)
  const markdownByPage = buildPages(document, assetsDirName)
  // 欠落を測るときは、本文に連ねない種別(ヘッダー・フッター・ページ番号・
  // キャプション)も含める。文字層はページに書かれた文字をすべて持つので、
  // 片側だけを絞ると、正常に分けられたものまで欠落として数えてしまう。
  const allByPage = groupByPage(document.blocks)

  const work: PageWork[] = []
  for (let page = 0; page < document.pageCount; page += 1) {
    const pageBlocks = bodyByPage.get(page) ?? []
    const converted = markdownByPage.get(page) ?? ''

    const pieces: string[] = []
    let missing = false
    for (const block of pageBlocks) {
      const region = layer.regions.get(block.id)
      if (region === undefined || region.trim().length === 0) {
        missing = true
        continue
      }
      pieces.push(region)
    }
    // 領域で引けない箇所があればページ全体を添える。対応づけの誤りは受け入れる。
    const textLayer = missing || pieces.length === 0 ? (layer.pages[page] ?? '') : pieces.join('\n\n')

    const gap = pageGap(layer, allByPage.get(page) ?? [], page)
    work.push({
      page,
      gap,
      input: {
        page,
        pageCount: document.pageCount,
        converted,
        textLayer,
        focus: needsFocus(gap),
        // 図の参照しか無いページは、突き合わせる相手が無いとみなす。
        transcribe: converted.replace(IMAGE_LINE, '').trim().length === 0 && textLayer.trim().length === 0,
        missingSamples: gap.samples,
      },
    })
  }
  return work
}

/**
 * ページ 1 枚ぶんの欠落を測る。
 *
 * ブロックごとに測らないのは、変換器が返す領域がそのブロックの内容と 1 対 1 に
 * 対応しないためである。参考文献の段のように、1 つのブロックの領域が隣の
 * ブロックの文字まで覆うことがあり、差が実体なく膨らむ。ページ全体で比べれば、
 * その紙面の文字が両側で 1 回ずつ数えられる。
 */
export function pageGap(layer: TextLayer, blocks: ConvertedDocument['blocks'], page: number): TextGap {
  // 数式は変換結果が LaTeX、文字層が素の字の並びなので突き合わせても意味を
  // 持たない。ただし文字層の側からは外せないため、変換結果の側に残して
  // 数式の中の文字が欠落として数えられないようにする。
  const converted = blocks.map((b) => b.markdown).join('\n')
  return textGap(layer.pages[page] ?? '', converted)
}

function groupByPage<T extends { page: number }>(blocks: T[]): Map<number, T[]> {
  const byPage = new Map<number, T[]>()
  for (const block of blocks) {
    const list = byPage.get(block.page) ?? []
    list.push(block)
    byPage.set(block.page, list)
  }
  return byPage
}
