/**
 * 照合の作業スレッドに与える指示と、応答の形。
 *
 * 食い違いの解決に向きを与えることがこの段階の要である(0004、0009)。
 */

export const VERIFY_INSTRUCTIONS = `あなたは論文の PDF を markdown へ変換した結果を、原本と突き合わせて直す。

入力は 1 ページぶんの次の 3 つである。

1. ページの画像。紙面の見た目そのもの。
2. 変換結果。そのページから機械が作った markdown のブロック。
3. 文字層。PDF に埋め込まれた文字を、同じ領域から取り出したもの。

食い違いを見つけたとき、どちらを採るかは種類ごとに決まっている。この向きに従うこと。

| 食い違いの種類 | 採る側 |
|---|---|
| 語・数値・固有名詞・引用番号・擬似コードの識別子と変数名といった文字そのもの | 文字層 |
| 読み順・段組みの結合・キャプションの帰属・表の行と列・数式の LaTeX・擬似コードの字下げと行の構造・記号の種別 | ページの画像 |
| 変換結果にも文字層にも対応する内容が無い | ページの画像 |

文字層は PDF に埋め込まれた文字をそのまま読んだものなので、綴りについては最も信頼できる。
ページの画像から字形を見て文字を読み直すことはしない。著者名・数値・引用番号を字形の読み違いで書き換えてはならない。
一方、文字層は紙面上の並びを持たない。読み順・字下げ・段の区切りは画像から判断する。

変換結果に含まれる置換文字(U+FFFD)や、意味の通らない記号の並びは、文字層に対応する文字があればそれで置き換える。

図の画像への参照(![](assets/...))はそのまま残す。図の中身を文字に起こさない。

どちらとも決めがたい食い違いは、変更を加えずに変更点の一覧へ記録する。推測で直さない。

出力はそのページの確定した markdown 全体と、変更点の一覧である。`

/** 応答の形。`outputSchema` で固定する。 */
export const VERIFY_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['markdown', 'changes'],
  properties: {
    markdown: {
      type: 'string',
      description: 'そのページの確定した markdown 全体',
    },
    changes: {
      type: 'array',
      description: '変更点の一覧。変更が無ければ空',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'source', 'before', 'after', 'reason'],
        properties: {
          kind: {
            type: 'string',
            enum: ['characters', 'structure', 'missing', 'undecided'],
            description: '食い違いの種類。undecided は決めがたく変更しなかったもの',
          },
          source: {
            type: 'string',
            enum: ['textLayer', 'pageImage', 'none'],
            description: 'どちらを採ったか。none は変更しなかったもの',
          },
          before: { type: 'string', description: '変換結果の側' },
          after: { type: 'string', description: '確定した側' },
          reason: { type: 'string', description: 'なぜその向きに従ったか' },
        },
      },
    },
  },
}

export type VerifyChange = {
  kind: 'characters' | 'structure' | 'missing' | 'undecided'
  source: 'textLayer' | 'pageImage' | 'none'
  before: string
  after: string
  reason: string
}

export type VerifyPageResult = {
  markdown: string
  changes: VerifyChange[]
}

export type VerifyPageInput = {
  page: number
  pageCount: number
  /** 変換結果のブロックを連ねた markdown。 */
  converted: string
  /** 同じ領域から引いた文字層。 */
  textLayer: string
  /** そのページを重点的に見るかどうか(0009)。 */
  focus: boolean
  /** 欠けた文字の例。 */
  missingSamples: string[]
}

export function buildVerifyPrompt(input: VerifyPageInput): string {
  const parts = [
    `${input.pageCount} ページ中の ${input.page + 1} ページ目である。`,
    '',
    '## 変換結果',
    '',
    input.converted.length > 0 ? input.converted : '(このページに本文のブロックは無い)',
    '',
    '## 文字層',
    '',
    input.textLayer.length > 0 ? input.textLayer : '(このページに埋め込まれた文字は無い)',
  ]
  if (input.focus) {
    parts.push(
      '',
      '## 重点的に見ること',
      '',
      `このページは、文字層にあって変換結果に無い文字が多い。変換器が文字を落とした可能性が高いので、綴りを丁寧に突き合わせること。欠けた文字の例: ${input.missingSamples.join(' ')}`,
    )
  }
  return parts.join('\n')
}
