import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * 全文検索の索引に入れる形へ、文を語の並びに直す(0019)。
 *
 * 索引を作るときと問い合わせるときの両方でこれを通す。両側で同じ規則に直すことで、
 * 語の切れ目と語形が揃う。
 */
export type Segmenter = (text: string) => string

type Token = { surface_form: string; basic_form: string }

type Tokenizer = { tokenize: (text: string) => Token[] }

const require = createRequire(import.meta.url)

/** kuromoji が読む辞書の場所。パッケージに同梱されている。 */
function dictionaryPath(): string {
  return join(dirname(require.resolve('kuromoji')), '..', 'dict')
}

/**
 * 辞書を読み込んで解析器を作る。
 *
 * 読み込みは数百ミリ秒かかるので、起動時に 1 度だけ行って使い回す。
 */
export async function buildSegmenter(): Promise<Segmenter> {
  const kuromoji = require('kuromoji') as {
    builder: (options: { dicPath: string }) => {
      build: (done: (error: Error | null, tokenizer: Tokenizer) => void) => void
    }
  }

  const tokenizer = await new Promise<Tokenizer>((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath() }).build((error, built) => {
      if (error !== null) reject(error)
      else resolve(built)
    })
  })

  return (text) => segmentWith(tokenizer, text)
}

/** 1 度に渡す長さの上限。長い文字列をそのまま渡すと解析が重くなる。 */
const CHUNK_LINES = 40

function segmentWith(tokenizer: Tokenizer, text: string): string {
  const words: string[] = []
  const lines = text.split('\n')
  for (let at = 0; at < lines.length; at += CHUNK_LINES) {
    const part = lines.slice(at, at + CHUNK_LINES).join('\n').trim()
    if (part.length === 0) continue
    for (const token of tokenizer.tokenize(part)) {
      // 活用する語は基本形に直す。辞書に無い語は基本形が `*` で返る。
      const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form
      const word = base.trim()
      if (word.length > 0) words.push(word)
    }
  }
  return words.join(' ')
}
