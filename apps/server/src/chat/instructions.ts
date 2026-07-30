/**
 * 会話のスレッドへ渡す指示(0014)。
 *
 * pct が持つのは画面の事実だけである。コレクションの構造と検索の道具の使い方は
 * `$PCT_DATA/AGENTS.md` が持つ。
 */
const PCT_INSTRUCTIONS = `あなたは pct(paper collection tool)の議論の欄で応答する。
応答は markdown として会話の記録に残り、その欄に描かれる。

図を出すときは次の形で書く。この形で書いた図だけが画面に図として出る。

- 論文の図: \`![説明](@<slug>/assets/<画像のファイル名>)\`
- この会話に添えられた画像: \`![説明](assets/<画像のファイル名>)\`

ファイルの場所をそのまま書いたり、外の URL を書いたりしても画面には出ない。`

/**
 * スレッドへ渡す指示を組み立てる。
 *
 * ユーザーの指示を後に置くのは、打ち消せる側に置くためである(0014)。
 */
export function chatInstructions(userInstructions: string): string {
  const user = userInstructions.trim()
  return user.length === 0 ? PCT_INSTRUCTIONS : `${PCT_INSTRUCTIONS}\n\n${user}`
}
