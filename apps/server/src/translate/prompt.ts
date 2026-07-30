/** 翻訳の作業スレッドに与える指示と、要求の組み立て。 */

export const TRANSLATE_INSTRUCTIONS = `あなたは英語の論文を日本語へ訳す。
入力は論文の一部(見出し 1 つぶん)の markdown で、出力はその日本語訳の markdown だけである。
説明や前置きを付けず、訳文そのものを返すこと。

次のものは訳す対象ではない。原文のまま 1 文字も変えずに残すこと。

- 数式。$...$ と $$...$$ の中身、LaTeX の命令、記号、添字。
- 図の参照(![](assets/...))とリンクの URL。
- 脚注の参照。
- 見出しの深さ。原文が ## なら訳文も ## にする。見出しの文言は訳す。

数式の中の変数名を日本語に置き換えてはならない。
図の参照を訳文の位置に合わせて動かしてもよいが、参照そのものは変えない。

訳語は論文の中で揃える。同じ用語を場所によって別の訳語にしない。
技術用語は、日本語の技術文書で慣例的に使われる語を選ぶ。
定訳が無い用語は英語のまま残してよい。

原文に無い内容を足さない。原文にある内容を落とさない。`

export type TranslateRequest = {
  /** 論文のタイトル。何についての論文かを示さないと訳語が定まらない(0004)。 */
  title: string
  /** 英語の abstract。同じ理由で添える。 */
  abstract: string
  /** 何番目の節か。 */
  index: number
  total: number
  markdown: string
  /** 直前の要求が契約に反したときの、やり直しの指示。 */
  breach?: string
}

export function buildTranslatePrompt(request: TranslateRequest): string {
  const parts = [
    `論文「${request.title}」の ${request.total} 節中 ${request.index + 1} 節目を訳せ。`,
    '',
    '## この論文の abstract(文脈。訳す対象ではない)',
    '',
    request.abstract.length > 0 ? request.abstract : '(無し)',
    '',
    '## 訳す本文',
    '',
    request.markdown,
  ]
  if (request.breach !== undefined) {
    parts.push(
      '',
      '## やり直しの理由',
      '',
      `前の訳は、原文のまま残すべきものを変えていた: ${request.breach}`,
      '数式・図の参照・リンク・見出しの深さを原文どおりにして訳し直すこと。',
    )
  }
  return parts.join('\n')
}
