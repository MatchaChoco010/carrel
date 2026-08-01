/** 書いている途中の応答の見え方。送ってから本文が出るまでの間も印を出す(#237)。 */
export type TurnPhase = 'sending' | 'waiting' | 'writing'

export type Turn = { id: string; delta: string; phase: TurnPhase }

/**
 * 会話を読み込んだときの、書いている途中の応答の扱い(#262)。
 *
 * 差分は届いたそばから `previous` に積まれる。会話を開き直したときは、それ以前の
 * 差分を画面が持っていないので、サーバーが持っている本文(`partial`)を土台にする。
 * 土台は前に付ける。読み込みを待つ間に届いた差分は `previous` の側にあり、それは
 * 土台より後に書かれたものだからである。
 *
 * `restore` は会話を開いたときだけ真にする。開いたままの読み直し(題の書き換えなど)で
 * 土台を付けると、既に持っている本文と二重になる。
 */
export function turnAfterLoad(
  previous: Turn | null,
  loaded: { id: string; running: boolean; partial: string | null },
  restore: boolean,
): Turn | null {
  if (!loaded.running) return null
  if (!restore) return previous ?? { id: loaded.id, delta: '', phase: 'writing' }
  return { id: loaded.id, delta: (loaded.partial ?? '') + (previous?.delta ?? ''), phase: 'writing' }
}
