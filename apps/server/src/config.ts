import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { configDir, configFile } from './paths.ts'

export type Config = {
  dataDir: string
  server: {
    host: string
    port: number
  }
  arxiv: {
    categories: string[]
    fetchIntervalMinutes: number
    /** 取得位置の記録が無いときに遡る日数。 */
    initialLookbackDays: number
  }
  chat: {
    defaultModel: string
    defaultEffort: string
  }
}

export const defaultConfig: Config = {
  dataDir: join(homedir(), 'pct-data'),
  server: { host: '0.0.0.0', port: 7817 },
  arxiv: {
    categories: ['cs.GR'],
    fetchIntervalMinutes: 180,
    initialLookbackDays: 7,
  },
  chat: {
    defaultModel: 'gpt-5.6-sol',
    defaultEffort: 'high',
  },
}

/**
 * 保存された設定を既定値の上に重ねる。
 *
 * 欠けているキーと範囲外の値は既定値で埋め、未知のキーは捨てる。
 * 設定ファイルを手で編集して一部だけを書いた場合でも起動できる。
 */
export function mergeConfig(stored: unknown): Config {
  if (typeof stored !== 'object' || stored === null) return structuredClone(defaultConfig)
  const raw = stored as Record<string, unknown>
  const merged = structuredClone(defaultConfig)

  if (typeof raw['dataDir'] === 'string' && raw['dataDir'].length > 0) {
    merged.dataDir = raw['dataDir']
  }

  const server = raw['server']
  if (typeof server === 'object' && server !== null) {
    const s = server as Record<string, unknown>
    if (typeof s['host'] === 'string' && s['host'].length > 0) {
      merged.server.host = s['host']
    }
    const port = s['port']
    if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536) {
      merged.server.port = port
    }
  }

  const arxiv = raw['arxiv']
  if (typeof arxiv === 'object' && arxiv !== null) {
    const a = arxiv as Record<string, unknown>
    if (Array.isArray(a['categories'])) {
      merged.arxiv.categories = a['categories'].filter((c): c is string => typeof c === 'string' && c.length > 0)
    }
    if (typeof a['fetchIntervalMinutes'] === 'number' && a['fetchIntervalMinutes'] > 0) {
      merged.arxiv.fetchIntervalMinutes = a['fetchIntervalMinutes']
    }
    if (typeof a['initialLookbackDays'] === 'number' && a['initialLookbackDays'] > 0) {
      merged.arxiv.initialLookbackDays = a['initialLookbackDays']
    }
  }

  const chat = raw['chat']
  if (typeof chat === 'object' && chat !== null) {
    const c = chat as Record<string, unknown>
    if (typeof c['defaultModel'] === 'string' && c['defaultModel'].length > 0) {
      merged.chat.defaultModel = c['defaultModel']
    }
    if (typeof c['defaultEffort'] === 'string' && c['defaultEffort'].length > 0) {
      merged.chat.defaultEffort = c['defaultEffort']
    }
  }

  return merged
}

/** 設定を読む。ファイルが無ければ既定値を書き出してからそれを返す。 */
export async function loadConfig(): Promise<Config> {
  const file = configFile()
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const config = structuredClone(defaultConfig)
    await saveConfig(config)
    return config
  }
  return mergeConfig(JSON.parse(text))
}

export async function saveConfig(config: Config): Promise<void> {
  const file = configFile()
  await mkdir(configDir(), { recursive: true })
  // 書き込み中に読まれても中途半端な内容を渡さないよう、同じディレクトリへ
  // 書いてから rename する。
  const tmp = join(dirname(file), `.config.json.${process.pid}.tmp`)
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}
