/** 取り込みの段階。 */
export type IngestStage = 'resolve' | 'fetch' | 'convert' | 'verify' | 'translate' | 'register'

export const INGEST_STAGES: IngestStage[] = ['resolve', 'fetch', 'convert', 'verify', 'translate', 'register']

export type SourceKind = 'pdf' | 'html'

/** 解決の段階が確定させるもの。 */
export type ResolvedSource = {
  /** 取得すべき原本の場所。 */
  originalUrl: string
  kind: SourceKind
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  arxivId: string | null
  /** 出版元が付けた識別子。参考文献との突き合わせに使う(0015)。 */
  doi: string | null
  /** slug のタイトル由来の部分の候補。 */
  slugKeyword: string | null
  /** どの経路で解決したか。 */
  via: 'arxiv' | 'agent'
}

export type ResolveOutcome =
  | { kind: 'resolved'; source: ResolvedSource; sourceUrl: string }
  /** 既に取り込んである論文と同じだと分かった場合。 */
  | { kind: 'duplicate'; slug: string; reason: 'arxivId' | 'sourceUrl' }
