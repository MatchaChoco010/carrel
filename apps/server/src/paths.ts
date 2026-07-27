import { homedir } from 'node:os'
import { join } from 'node:path'

// pct が使うローカルディスク上の場所を決める。
//
// 論文とチャットは $PCT_DATA(NAS)に置くが、設定と索引はローカルに置く(0002)。
// 索引を NAS に置かないのは、SQLite のロックがネットワークファイルシステム上で
// 信頼できないことと、索引が markdown から作り直せてバックアップの価値がないため。

function xdg(envName: string, fallback: string): string {
  const value = process.env[envName]
  return value && value.length > 0 ? value : join(homedir(), fallback)
}

/** 設定ファイルを置くディレクトリ。 */
export function configDir(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'pct')
}

/** 索引と運用状態を置くディレクトリ。 */
export function stateDir(): string {
  return join(xdg('XDG_STATE_HOME', '.local/state'), 'pct')
}

export function configFile(): string {
  return join(configDir(), 'config.json')
}

/** markdown から作り直せる派生データ。消してよい。 */
export function indexDbFile(): string {
  return join(stateDir(), 'index.sqlite')
}

/** フィードの取得位置・未読・ジョブキュー。markdown に対応物を持たない。 */
export function stateDbFile(): string {
  return join(stateDir(), 'state.sqlite')
}
