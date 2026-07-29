import { BODY_KINDS, type ConvertedBlock, type ConvertedDocument } from './types.ts'

/** 本文に連ねるブロックを、ページ順に並べて返す。 */
export function bodyBlocks(document: ConvertedDocument): ConvertedBlock[] {
  const kinds = new Set(BODY_KINDS)
  return document.blocks
    .filter((b) => kinds.has(b.kind) && b.markdown.length > 0)
    .sort((a, b) => a.page - b.page || compareId(a.id, b.id))
}

/**
 * 同じページの中の順序は、変換器が付けた識別子の末尾の連番で決まる。
 *
 * 識別子は `/page/12/Text/3` の形なので、文字列のまま比べると 3 が 21 より
 * 後ろに来る。
 */
function compareId(a: string, b: string): number {
  const na = trailingNumber(a)
  const nb = trailingNumber(b)
  if (na !== null && nb !== null && na !== nb) return na - nb
  return a.localeCompare(b)
}

function trailingNumber(id: string): number | null {
  const m = /\/(\d+)$/.exec(id)
  return m === null ? null : Number(m[1])
}

/**
 * 本文の markdown を組み立てる。
 *
 * 図は本文の流れの中へ、画像とキャプションを組にした形で差し込む(0004)。
 * キャプションのブロックは本文に連ねないので、地の文には混ざらない。
 */
export function buildBody(document: ConvertedDocument, assetsDirName: string): string {
  const blocksByPage = new Map<number, ConvertedBlock[]>()
  for (const block of bodyBlocks(document)) {
    const list = blocksByPage.get(block.page) ?? []
    list.push(block)
    blocksByPage.set(block.page, list)
  }
  const figuresByPage = new Map<number, ConvertedDocument['figures']>()
  for (const figure of document.figures) {
    const list = figuresByPage.get(figure.page) ?? []
    list.push(figure)
    figuresByPage.set(figure.page, list)
  }

  // 全面が図のページには本文のブロックが無い。本文の並びではなくページを軸に
  // することで、そうしたページの図も落とさない。
  const pages = [...new Set([...blocksByPage.keys(), ...figuresByPage.keys()])].sort((a, b) => a - b)

  const parts: string[] = []
  for (const page of pages) {
    // 図を本文の後ろへまとめず、紙面の読み順に差し込む。変換器が付ける識別子の
    // 末尾の番号がその順序を表すので、本文のブロックと図を同じ列に並べる。
    // まとめて置くと、紙面では題の直後にある図が abstract より後ろへ回る。
    const items: Array<{ order: number; text: string }> = [
      ...(blocksByPage.get(page) ?? []).map((b) => ({ order: blockOrder(b.id), text: renderBlock(b) })),
      ...(figuresByPage.get(page) ?? []).map((f) => ({
        order: blockOrder(f.blockId),
        text: renderFigure(f, assetsDirName),
      })),
    ]
    for (const item of items.sort((a, b) => a.order - b.order)) parts.push(item.text)
  }

  return `${parts.join('\n\n')}\n`
}

/** 識別子の末尾の番号。紙面の読み順を表す。 */
function blockOrder(id: string): number {
  const m = /\/(\d+)$/.exec(id)
  return m === null ? Number.MAX_SAFE_INTEGER : Number(m[1])
}

/**
 * 変換器は数式のブロックを素の LaTeX で返す。
 *
 * 区切りが無いと markdown として数式に見えず、後の段階も数式として扱えない。
 * 0004 は数式を LaTeX として表現することを契約にしているので、ここで囲む。
 */
function renderBlock(block: ConvertedBlock): string {
  if (block.kind !== 'equation') return block.markdown
  const text = block.markdown.trim()
  if (text.startsWith('$$') || text.startsWith('\\begin{')) return text
  return `$$\n${text}\n$$`
}

function renderFigure(figure: ConvertedDocument['figures'][number], assetsDirName: string): string {
  const image = `![](${assetsDirName}/${figure.image})`
  if (figure.caption.length === 0) return image
  return `<figure>\n\n${image}\n\n<figcaption>\n\n${figure.caption}\n\n</figcaption>\n\n</figure>`
}

/** ブロックの識別子からページ番号を引く表。照合がページ画像と組にするのに使う(0004)。 */
export function pageIndex(document: ConvertedDocument): Map<string, number> {
  return new Map(document.blocks.map((b) => [b.id, b.page]))
}
