/** arXiv の API から取った 1 件。 */
export type FeedEntry = {
  arxivId: string
  category: string
  title: string
  authors: string[]
  abstract: string | null
  /** 投稿日時。次回の取得の起点にも使う。 */
  publishedAt: number
}

/** フィードに並ぶ 1 件。 */
export type FeedItem = FeedEntry & {
  abstractJa: string | null
  read: boolean
  /** この論文を取り込んだときの slug。まだなら null。 */
  slug: string | null
  addedAt: number
}
