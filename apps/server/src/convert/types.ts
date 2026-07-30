/**
 * 変換器との境界。
 *
 * pct が依存するのはこの形までで、変換器が出力する markdown の書き方には依存しない。
 */

/** ブロックの種別。変換器固有の名前はここへ写して受ける。 */
export type BlockKind =
  | 'text'
  | 'sectionHeader'
  | 'listItem'
  | 'caption'
  | 'figure'
  | 'table'
  | 'equation'
  | 'code'
  | 'footnote'
  | 'reference'
  | 'pageHeader'
  | 'pageFooter'
  | 'pageNumber'
  | 'other'

/** 本文として連ねる種別。ヘッダー・フッター・ページ番号は本文に入れない。 */
export const BODY_KINDS: readonly BlockKind[] = [
  'text',
  'sectionHeader',
  'listItem',
  'table',
  'equation',
  'code',
  'footnote',
]

/** 紙面上の位置。左上を原点とし、単位は PDF の座標系に合わせる。 */
export type Bbox = {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type ConvertedBlock = {
  /** 変換器が付けた識別子。ページ番号と種別と連番からなる。 */
  id: string
  kind: BlockKind
  /** 0 始まりのページ番号。 */
  page: number
  bbox: Bbox
  /** そのブロックの markdown。図のブロックでは空になる。 */
  markdown: string
  /** 図のブロックのとき、`assets/` に置いた画像のファイル名。 */
  image: string | null
  /** 変換器が図とキャプションをまとめた組の識別子。まとめていなければ null。 */
  groupId: string | null
}

/** 図表とそのキャプションの組。 */
export type ConvertedFigure = {
  /** 図のブロックの識別子。 */
  blockId: string
  page: number
  image: string
  /** キャプションの markdown。見つからなければ空文字。 */
  caption: string
}

export type ConvertedDocument = {
  pageCount: number
  blocks: ConvertedBlock[]
  figures: ConvertedFigure[]
}
