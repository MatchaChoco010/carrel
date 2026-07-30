/**
 * 埋め込みの生成。
 *
 * 日本語の問い合わせと英語の文書を同じ空間に置けることが要件なので、多言語の
 * モデルを使う(0005)。
 */

export type EmbedOptions = {
  /** Ollama の口。 */
  baseUrl: string
  model: string
  signal?: AbortSignal
}

export type Embedder = (texts: string[]) => Promise<Float32Array[]>

/** 1 回の要求に載せる本数。多すぎると応答が大きくなりすぎる。 */
const BATCH = 16

function parseEmbeddings(value: unknown): Float32Array[] {
  if (typeof value !== 'object' || value === null) throw new Error('埋め込みの応答が読めない')
  const raw = (value as Record<string, unknown>)['embeddings']
  if (!Array.isArray(raw)) throw new Error('埋め込みの応答に embeddings が無い')
  return raw.map((v) => {
    if (!Array.isArray(v)) throw new Error('埋め込みが数の並びではない')
    return Float32Array.from(v as number[])
  })
}

export function createEmbedder(options: EmbedOptions): Embedder {
  return async (texts) => {
    const out: Float32Array[] = []
    for (let at = 0; at < texts.length; at += BATCH) {
      const batch = texts.slice(at, at + BATCH)
      const response = await fetch(new URL('/api/embed', options.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: batch }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (!response.ok) {
        throw new Error(`埋め込みを作れなかった (${response.status}): ${await response.text()}`)
      }
      const vectors = parseEmbeddings(await response.json())
      if (vectors.length !== batch.length) {
        throw new Error(`埋め込みの数が合わない: ${batch.length} 件送って ${vectors.length} 件返った`)
      }
      out.push(...vectors)
    }
    return out
  }
}

/** ベクトルを SQLite に置くための並び。 */
export function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function fromBlob(blob: Uint8Array): Float32Array {
  // SQLite から返る並びは 4 の倍数に揃っているとは限らないので写して整える。
  const copy = Uint8Array.from(blob)
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

/**
 * 余弦の近さ。
 *
 * 長さで割るのは、モデルが正規化された値を返すとは限らないためである。
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
