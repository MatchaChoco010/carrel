import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 開くべきサーバーの URL を決める。
 *
 * サーバーの待ち受けはユーザーの設定なので(0007)、同じ設定ファイルから読む。
 * 待ち受けが `0.0.0.0` でも、この窓は同じ PC から繋ぐのでループバックを使う。
 */

/** 透過モードで開くことを UI へ伝える印。Web 側の `main.tsx` がこの値を見る。 */
export const SURFACE_MARK = 'surface=desktop'

const FALLBACK = { host: '127.0.0.1', port: 7817 }

/** 全てのアドレスで待ち受ける指定。この窓からはループバックで繋ぐ。 */
const ANY_ADDRESS = new Set(['0.0.0.0', '::', ''])

export function serverOrigin(server: { host?: unknown; port?: unknown }): string {
  const host = typeof server.host === 'string' && !ANY_ADDRESS.has(server.host) ? server.host : FALLBACK.host
  const port = typeof server.port === 'number' && Number.isFinite(server.port) ? server.port : FALLBACK.port
  // IPv6 のアドレスは括弧で囲む必要がある。
  const authority = host.includes(':') ? `[${host}]` : host
  return `http://${authority}:${port}`
}

export function appUrl(origin: string): string {
  return `${origin}/?${SURFACE_MARK}`
}

export function healthUrl(origin: string): string {
  return `${origin}/api/health`
}

function configFile(): string {
  const base = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')
  return join(base, 'pct', 'config.json')
}

/** 設定が読めないときは既定の待ち受けを使う。窓は出して、繋がるのを待つ。 */
export async function readServerOrigin(): Promise<string> {
  try {
    const raw: unknown = JSON.parse(await readFile(configFile(), 'utf8'))
    const server = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['server'] : null
    return serverOrigin(typeof server === 'object' && server !== null ? (server as Record<string, unknown>) : {})
  } catch {
    return serverOrigin({})
  }
}
