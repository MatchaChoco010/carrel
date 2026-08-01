/** 取り込みの段階。 */
export type IngestStage =
  | 'resolve'
  | 'fetch'
  | 'convert'
  | 'verify'
  | 'bibliography'
  | 'translate'
  | 'references'
  | 'register'

export const INGEST_STAGES: IngestStage[] = [
  'resolve',
  'fetch',
  'convert',
  'verify',
  'bibliography',
  'translate',
  'references',
  'register',
]

export type SourceKind = 'pdf' | 'html'

/** 解決の段階が確定させるもの。 */
export type ResolvedSource = {
  /** 取得すべき原本の場所。手元から入れたときは、既に原本があるので null。 */
  originalUrl: string | null
  /** 1 つ目が取れなかったときに試す、同じ論文の別の所在。 */
  alternateUrls: string[]
  kind: SourceKind
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  arxivId: string | null
  /** 出版元が付けた識別子。参考文献との突き合わせに使う(0015)。 */
  doi: string | null
  /**
   * slug の語幹を作るときに、規則が飛ばす語のうち落とさずに拾う語(0023)。
   *
   * `von Mises-Fisher` の `von` のように、冠詞・前置詞・姓の前置きが固有名詞の一部で
   * ある場合に名指しする。語幹そのものは指せない。
   */
  slugKeepWords: string[]
  /** どの経路で解決したか。 */
  via: 'arxiv' | 'agent' | 'original'
}

export type ResolveOutcome =
  /** 手元から入れたときは、指定された URL が無いので `sourceUrl` は null になる(0021)。 */
  | { kind: 'resolved'; source: ResolvedSource; sourceUrl: string | null }
  /** 既に取り込んである論文と同じだと分かった場合。 */
  | { kind: 'duplicate'; slug: string; reason: 'arxivId' | 'sourceUrl' | 'title' }
