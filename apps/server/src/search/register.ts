import type { Paper } from '../data/paper.ts'
import { readPaper, readPaperSideFile } from '../data/paper.ts'
import { buildChunks } from './chunks.ts'
import type { Embedder } from './embed.ts'
import type { ChunkInput, ChunkStore, EmbeddingModel } from './store.ts'

export type RegisterDeps = {
  dataDir: string
  chunks: ChunkStore
  embed: Embedder
  model: EmbeddingModel
  /** 論文を索引に載せる。チャンクが参照するので、入れる直前に呼ぶ。 */
  indexPaper: (paper: Paper) => void
  /** 埋め込みが今の本文のものになったことを索引へ伝える。 */
  markEmbedded: (slug: string) => void
}

/**
 * 論文をチャンクに切って索引へ載せる。
 *
 * 英語の本文と和訳の両方を入れる。多言語のモデルは言語をまたいだ検索ができるが、
 * 同じ言語同士のほうが近さの判定は安定するので、日本語で問い合わせたときに和訳の
 * チャンクが素直に当たる経路を持たせておく(0005)。
 */
export async function registerPaper(slug: string, deps: RegisterDeps): Promise<number> {
  const paper = await readPaper(deps.dataDir, slug)
  if (paper === null) throw new Error(`論文が読めない: ${slug}`)
  const ja = await readPaperSideFile(deps.dataDir, slug, 'bodyJa')

  const inputs: ChunkInput[] = []
  for (const [lang, body] of [
    ['en', paper.body],
    ['ja', ja ?? ''],
  ] as const) {
    for (const chunk of buildChunks(body)) {
      inputs.push({ lang, position: chunk.index, path: chunk.path, text: chunk.text, vector: null })
    }
  }
  if (inputs.length === 0) {
    deps.indexPaper(paper)
    deps.chunks.replace(slug, [])
    deps.markEmbedded(slug)
    return 0
  }

  const vectors = await deps.embed(inputs.map((c) => c.text))
  for (let i = 0; i < inputs.length; i += 1) {
    const vector = vectors[i]
    if (vector !== undefined) (inputs[i] as ChunkInput).vector = vector
  }

  // ここから下に await を挟まない。埋め込みを待つ間にファイルの監視が走ると、
  // 取り込みの途中の論文として索引から外され、外部キーが破れる。
  deps.indexPaper(paper)
  deps.chunks.replace(slug, inputs)
  deps.chunks.setModel(deps.model)
  deps.markEmbedded(slug)
  return inputs.length
}
