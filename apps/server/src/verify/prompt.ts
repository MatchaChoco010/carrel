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

変換器が壊すのは紙面の構造である。次はいずれも変換器が誤りやすく、紙面を見なければ気づけない。ページの画像と変換結果を突き合わせ、毎回すべて確かめること。

- 2 段組みの読み順。左段の途中に右段の文が紛れていないか。段をまたいで文が切れていないか。
- 図表のキャプションの帰属。キャプションが本文の地の文に混ざっていないか。どの図表のものか。
- 表の行と列。見出しの行と列が失われて、値が 1 列に潰れていないか。
- 擬似コードの字下げと行の区切り。入れ子の深さが平らになっていないか。
- 見出しの階層。節と小節の深さが紙面の見た目と合っているか。
- 数式の構造。添字の位置・括弧の対応・分数と行列の形。
- 紙面にあって変換結果に無いもの。段落・キャプション・脚注が丸ごと落ちていないか。

文字の綴りだけを見て済ませてはならない。上の構造の確認は、綴りに問題が無いページでも毎回行う。

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

数式は変換器が読み取れないことが多い。次のいずれかに当たる数式は、紙面の画像を見て LaTeX で書き直すこと。

- 置換文字(U+FFFD)や意味の通らない記号の並びを含む。
- 数学用の Unicode 文字(𝑓 や 𝛼 のような書体つきの文字)がそのまま並んでいる。
- 分数・積分・総和・行列が、記号を横に並べただけの形になっている。

このとき文字層は当てにならない。文字層でも数式の字は壊れているので、紙面の画像から読み取る。
別行立ての数式は \`$$\` で、文中の数式は \`$\` で囲む。式の番号は式の外に残す。

図の画像への参照(\`![](assets/...)\`)は、変換結果にあるものを 1 つ残らず、同じ位置に残す。
これは carrel が紙面から切り出した画像を指す行であり、照合の対象ではない。紙面に文字として現れないので確かめようがないが、消してよいという意味ではない。
落とすと図がどこにあったかが失われる。図の中身を文字に起こすこともしない。

どちらとも決めがたい食い違いは、変更を加えずに変更点の一覧へ記録する。推測で直さない。

出力はそのページの確定した markdown 全体と、変更点の一覧である。`

/**
 * 文字層も変換結果も空のページに与える指示。
 *
 * 突き合わせる相手が無いので、向きの表を中心にした照合の指示は成り立たない。
 */
export const TRANSCRIBE_INSTRUCTIONS = `あなたは論文の紙面の画像を読み、その 1 ページを markdown に書き起こす。

この PDF には文字が埋まっていないので、突き合わせる相手は無い。画像に見えるものだけが手がかりである。

紙面に見えるとおりに、次を守って書き起こす。

- 読み順。2 段組みなら左段を上から下まで読み切ってから右段へ移る。段をまたいで文を切らない。
- 見出しは節の深さに合わせた \`#\` の数で書く。番号は見出しの文に含める。
- 図表のキャプションは本文の地の文に混ぜない。キャプションとして独立させる。
- 表は markdown の表にする。行と列を紙面のとおりに保つ。
- 数式は LaTeX で書く。別行立ては \`$$\`、文中は \`$\` で囲む。式の番号は式の外に残す。
- 擬似コードは行の区切りと字下げを保つ。
- 紙面に見えないものを補わない。読めない箇所は読めるところまでにとどめ、変更点の一覧に記録する。

ヘッダー・フッター・ページ番号・著作権表示は書き起こさない。紙面の内容ではないためである。

図の画像への参照(\`![](assets/...)\`)が入力にあれば、そのまま同じ位置に残す。

出力はそのページの markdown 全体と、読み取れなかった箇所の一覧である。`

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
  /** 突き合わせる相手が無く、画像から書き起こすページ。 */
  transcribe: boolean
  /** 欠けた文字の例。 */
  missingSamples: string[]
}

/** 図の画像を指す行。変換の段階で本文へ差し込んである。 */
export const IMAGE_LINE = /^!\[[^\]]*\]\(assets\/[^)]+\)$/gm

export function buildVerifyPrompt(input: VerifyPageInput): string {
  const parts = input.transcribe
    ? [
        `${input.pageCount} ページ中の ${input.page + 1} ページ目である。`,
        '',
        'この PDF には文字が埋まっていない。紙面の画像から書き起こすこと。',
      ]
    : [
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
  // 図の参照は紙面に文字として現れないので、指示だけでは落ちる。このページにある
  // ものを名指しで挙げる。
  const images = input.converted.match(IMAGE_LINE) ?? []
  if (images.length > 0) {
    parts.push(
      '',
      '## 残す図の参照',
      '',
      `このページの変換結果には次の ${images.length} 個の図の参照がある。出力にはこれらをすべて、紙面で図があった位置に含めること。`,
      '',
      ...images,
    )
  }
  if (input.focus) {
    parts.push(
      '',
      '## 重点的に見ること',
      '',
      `このページは、文字層にあって変換結果に無い文字が多い。変換器が文字を落とした可能性が高いので、構造の確認に加えて綴りも丁寧に突き合わせること。欠けた文字の例: ${input.missingSamples.join(' ')}`,
      '',
      '構造の確認を省いてよいという意味ではない。読み順・キャプションの帰属・表の行と列・字下げ・見出しの階層は、このページでも通常どおり確かめること。',
    )
  }
  return parts.join('\n')
}
