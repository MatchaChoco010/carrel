import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * `$PCT_DATA/AGENTS.md` を置く。
 *
 * 会話スレッドは `$PCT_DATA` を作業ディレクトリとして立つので(0003)、Codex は
 * ここを自分の指示として読む。コレクションの構造と検索の使い方を伝える先が要る(0002)。
 *
 * 起動のたびに書き直す。ユーザーが書き換えるための場所ではなく、pct が持つ説明である。
 */
const BODY = `# このディレクトリについて

ここは pct(paper collection tool)が管理する論文のコレクションである。
論文とその和訳、そして論文についての議論の記録が置かれている。

## 構造

\`\`\`
papers/<slug>/
  paper.md          英語の本文。frontmatter に論文のメタデータ
  paper.ja.md       日本語訳の本文
  abstract.md       英語の abstract
  abstract.ja.md    日本語訳の abstract
  paper.raw.md      照合を行う前の変換結果
  verification.md   照合でページごとに何をどう変えたかの記録
  original.pdf      取得した原本
  assets/           本文から参照する図表の画像
  pages/            PDF を 1 ページずつ画像化したもの
chats/YYYY/MM/DD/   議論の記録
\`\`\`

\`slug\` は \`<筆頭著者の姓><出版年>-<タイトル由来の短い語>\` の形で、論文を指す不変の名前である。

## 論文を探す

pct の MCP の道具を使う。

- \`search_papers\` — 語句と条件で論文を探す。語句は日本語でも英語でもよい。日本語の問い合わせで英語の本文にも当たる。
- \`list_tags\` — 付いているタグと、それぞれの論文の数を返す。

**本文は道具では返らない。** 返るのはファイルの場所なので、必要な節を自分で読むこと。
論文 1 本は数万トークンあるため、全文を読み込むより、当たった節を読んで足りなければ読み足すほうがよい。

## 気をつけること

- 本文は PDF からの変換と AI による照合を経ている。数値と固有名詞は \`original.pdf\` で確かめられる。
- 和訳は AI による訳である。訳が疑わしいときは \`paper.md\` の原文を読む。
- このディレクトリのファイルを書き換えない。コレクションはユーザーが育てる記録である。
`

export async function writeAgentsMd(dataDir: string): Promise<void> {
  await writeFile(join(dataDir, 'AGENTS.md'), BODY, 'utf8')
}
