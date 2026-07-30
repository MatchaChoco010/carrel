import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

function xdg(envName: string, fallback: string): string {
  const value = process.env[envName]
  return value && value.length > 0 ? value : join(homedir(), fallback)
}

export function configDir(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'pct')
}

export function stateDir(): string {
  return join(xdg('XDG_STATE_HOME', '.local/state'), 'pct')
}

export function configFile(): string {
  return join(configDir(), 'config.json')
}

export function indexDbFile(): string {
  return join(stateDir(), 'index.sqlite')
}

export function stateDbFile(): string {
  return join(stateDir(), 'state.sqlite')
}

function converterDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'converter')
}

/**
 * 変換器の venv の python。
 *
 * 動かしているコードと同じ clone の venv を既定にする。clone が複数あるときに、
 * どちらのコードを動かしても自分の隣を指す。
 */
export function converterPython(): string {
  return join(converterDir(), '.venv', 'bin', 'python')
}

/** 変換スクリプト。リポジトリの中の位置は動かないので、実行ファイルから辿る。 */
export function converterScript(): string {
  return join(converterDir(), 'pct_convert.py')
}

/** 文字層を取り出すスクリプト。 */
export function textLayerScript(): string {
  return join(converterDir(), 'pct_textlayer.py')
}

/**
 * ビルド済みの Web クライアントの場所。
 *
 * 開発時は vite の開発サーバーが配信するので、無ければ配信しない。
 */
export async function webRoot(): Promise<string | null> {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist')
  try {
    await access(join(candidate, 'index.html'))
    return relative(process.cwd(), candidate)
  } catch {
    return null
  }
}
