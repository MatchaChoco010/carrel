import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { appUrl, healthUrl, readServerOrigin } from './url.ts'

/**
 * サーバーの URL を開く窓。
 *
 * UI のコードは Web と同じで、ここに UI は持たない。この窓の責務は、透過した surface を
 * 作ること、サーバーが応答しないときに待つこと、外部のリンクを既定のブラウザへ渡すことだけ
 * である(0001)。
 */

const directory = dirname(fileURLToPath(import.meta.url))

/** 応答を待つ間の再接続の間隔。 */
const RETRY_MS = 1500

/** 生存の確認に待つ時間。落ちているときに窓が固まらない長さにする。 */
const PROBE_MS = 1000

let window: BrowserWindow | null = null

async function reachable(origin: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl(origin), { signal: AbortSignal.timeout(PROBE_MS) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * サーバーが応答するまで待ってから本来の URL を開く。
 *
 * 応答しない間はローカルの画面を出す。サーバーの URL を読み込めないときに窓が空になると、
 * 起動途中なのか壊れているのかが分からない。
 */
async function openWhenReady(target: BrowserWindow, origin: string): Promise<void> {
  if (await reachable(origin)) {
    await target.loadURL(appUrl(origin))
    return
  }

  await target.loadFile(join(directory, 'waiting.html'))
  const timer = setInterval(() => {
    void reachable(origin).then(async (ready) => {
      if (!ready || target.isDestroyed()) return
      clearInterval(timer)
      await target.loadURL(appUrl(origin))
    })
  }, RETRY_MS)
  target.on('closed', () => clearInterval(timer))
}

async function createWindow(): Promise<void> {
  const origin = await readServerOrigin()

  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // コンポジターが背後をぼかして合成できるように、surface を透明にする(0001)。
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  })
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })

  // 論文の元の URL などは既定のブラウザへ渡す。この窓の中では開かない。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin) && !url.startsWith('file:')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  // 読み込みに失敗したらローカルの画面へ戻し、また繋がるのを待つ。
  window.webContents.on('did-fail-load', (_event, _code, _description, url) => {
    if (url.startsWith('file:')) return
    void openWhenReady(window as BrowserWindow, origin)
  })

  await openWhenReady(window, origin)
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
