/**
 * 本文をチャンクに切る。
 *
 * 見出しを単位にするのは、著者が意味のまとまりとして付けた区切りだからである(0005)。
 */

export type Chunk = {
  /** 論文の中での通し番号。 */
  index: number
  /** 見出し経路。`3 手法 > 3.1 最適化` の形。 */
  path: string
  /** 埋め込みと抜粋に使う本文。 */
  text: string
}

/** 1 つのチャンクに入れる文字数の上限。 */
export const CHUNK_LIMIT = 1200
/** 分割したチャンク同士を重ねる文字数。 */
export const CHUNK_OVERLAP = 150

const HEADING = /^(#{1,6})\s+(.*)$/

type Block = { path: string; lines: string[] }

/**
 * 見出しの行を数える。
 *
 * コードブロックの中の `#` は見出しではない。擬似コードやシェルの例で行頭の
 * `#` が注釈として現れる。
 */
function* walk(markdown: string): Generator<{ line: string; heading: { level: number; text: string } | null }> {
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const opener = /^(\s*)(`{3,}|~{3,})/.exec(line)
    if (fence === null && opener !== null) {
      fence = opener[2] as string
      yield { line, heading: null }
      continue
    }
    if (fence !== null) {
      if (opener !== null && (opener[2] as string).startsWith(fence[0] as string)) fence = null
      yield { line, heading: null }
      continue
    }
    const m = HEADING.exec(line)
    yield { line, heading: m === null ? null : { level: (m[1] as string).length, text: (m[2] as string).trim() } }
  }
}

/** 見出しごとに本文をまとめ、見出し経路を付ける。 */
function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const stack: { level: number; text: string }[] = []
  let current: Block = { path: '', lines: [] }

  for (const { line, heading } of walk(markdown)) {
    if (heading === null) {
      current.lines.push(line)
      continue
    }
    if (current.lines.join('\n').trim().length > 0) blocks.push(current)
    while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= heading.level) stack.pop()
    stack.push(heading)
    current = { path: stack.map((h) => h.text).join(' > '), lines: [] }
  }
  if (current.lines.join('\n').trim().length > 0) blocks.push(current)
  return blocks
}

/**
 * 上限を超える本文を分割し、隣り合うものを少し重ねる。
 *
 * 重ねるのは、文の途中や論の展開の途中で切れたときに、どちらの側からも文脈が
 * 失われるのを防ぐためである(0005)。
 */
function split(text: string): string[] {
  if (text.length <= CHUNK_LIMIT) return [text]
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    const end = Math.min(at + CHUNK_LIMIT, text.length)
    // 段落の区切りで切れるならそこで切る。無ければ上限で切る。
    const boundary = end < text.length ? text.lastIndexOf('\n\n', end) : end
    const cut = boundary > at + CHUNK_OVERLAP ? boundary : end
    out.push(text.slice(at, cut).trim())
    if (cut >= text.length) break
    at = Math.max(cut - CHUNK_OVERLAP, at + 1)
  }
  return out.filter((s) => s.length > 0)
}

export function buildChunks(markdown: string): Chunk[] {
  const chunks: Chunk[] = []
  for (const block of toBlocks(markdown)) {
    const text = block.lines.join('\n').trim()
    if (text.length === 0) continue
    for (const part of split(text)) {
      chunks.push({ index: chunks.length, path: block.path, text: part })
    }
  }
  return chunks
}
