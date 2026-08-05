/**
 * 会話のスレッドへ渡す指示(0014)。
 *
 * carrel が持つのは画面の事実と、carrel が会話をどう動かすかである。コレクションの構造と
 * 検索の道具の使い方は `$CARREL_DATA/AGENTS.md` が持つ。
 */
const CARREL_INSTRUCTIONS = `あなたは carrel の議論の欄で応答する。
応答は markdown として会話の記録に残り、その欄に描かれる。

図を出すときは次の形で書く。この形で書いた図だけが画面に図として出る。

- 論文の図: \`![説明](@<slug>/assets/<画像のファイル名>)\`
- この会話に添えられた画像: \`![説明](assets/<画像のファイル名>)\`

ファイルの場所をそのまま書いたり、外の URL を書いたりしても画面には出ない。

論文を取り込むかどうかは利用者が決める。
探すよう言われただけなら、調べた結果を会話で示すところで止め、取り込みの道具を呼ばない。
取り込むよう明示的に言われたときだけ積むこと。

会話の途中に \`[carrel からの連絡]\` で始まる発言が入ることがある。
これは利用者が設定を書き替えたことを carrel が伝えるもので、常に最新のものが有効である。
連絡そのものには応答せず、以後の応答をその指示に従わせること。`

/**
 * スレッドへ渡す指示を組み立てる。
 *
 * ユーザーの指示を後に置くのは、打ち消せる側に置くためである(0014)。
 */
export function chatInstructions(userInstructions: string): string {
  const user = userInstructions.trim()
  return user.length === 0 ? CARREL_INSTRUCTIONS : `${CARREL_INSTRUCTIONS}\n\n${user}`
}

/**
 * 指示が入れ替わったことを伝える差し込み(0014)。
 *
 * スレッドの指示は立てた後に差し替えられないので、会話の中へ入れる。
 * 応答させないのは、ユーザーが打った発言への答えだけを記録に残すためである。
 */
export function instructionChangeNotice(userInstructions: string): string {
  const user = userInstructions.trim()
  return notice(
    user.length === 0
      ? 'これまでの利用者からの指示は取り消された。以後は carrel の指示だけに従うこと。'
      : `以後は次の指示に従うこと。これまでの利用者からの指示は取り消された。\n\n${user}`,
  )
}

/**
 * carrel の指示ごと差し込む(0014)。
 *
 * carrel の指示をスレッドの指示として持たないスレッドがある。指示の層を入れる前に
 * 立ったスレッドは、Codex の保存領域から再開できるので残り続ける。
 */
export function fullInstructionNotice(userInstructions: string): string {
  return notice(`以後は次の指示に従うこと。\n\n${chatInstructions(userInstructions)}`)
}

function notice(body: string): string {
  return ['[carrel からの連絡]', body, '', 'この連絡には応答しない。続く発言にだけ答えること。', '', '---', ''].join('\n')
}
