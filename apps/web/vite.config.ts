import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** dev-server.sh が設定を作る前に立ち上げたときに使う口。同じ値を持つ。 */
const FALLBACK_PORT = 7818

/**
 * 回す先を開発用サーバーの設定から読む。
 *
 * 本番の口へ固定で回すと、開発中の画面から本番のコレクションを消したり設定を
 * 書き替えたりできてしまう。
 */
function devServerPort(): number {
  try {
    const file = new URL('../../.dev/config/pct/config.json', import.meta.url)
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const server = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['server'] : null
    const port = typeof server === 'object' && server !== null ? (server as Record<string, unknown>)['port'] : null
    return typeof port === 'number' && Number.isInteger(port) ? port : FALLBACK_PORT
  } catch {
    return FALLBACK_PORT
  }
}

const port = devServerPort()

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${port}`,
      '/ws': { target: `ws://127.0.0.1:${port}`, ws: true },
    },
  },
})
