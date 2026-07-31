import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { configDir, configFile, converterPython } from './paths.ts'

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
    /** ユーザーが決める、応答の仕方への指示(0014)。 */
    instructions: string
    /** 入力欄で Enter を押したときに送るか。 */
    sendOnEnter: boolean
    /** 入力欄で Ctrl+Enter を押したときに送るか。 */
    sendOnCtrlEnter: boolean
  }
  ingest: {
    /** 取り込みの段階が使う Codex のモデル。 */
    model: string
    /** 取り込みの段階が使う reasoning effort。 */
    effort: string
    /** Codex の service tier。`priority` は速くなる代わりに利用量が増える。 */
    serviceTier: string | null
  }
  embedding: {
    /** Ollama の口。 */
    baseUrl: string
    /** 埋め込みのモデル。日本語と英語を同じ空間に置けるものを使う(0005)。 */
    model: string
    /** モデルが返すベクトルの次元。記録と違えば索引の作り直しが要る。 */
    dimensions: number
  }
  converter: {
    /** 変換器の venv の python。 */
    python: string
    /** llama.cpp の server 実行ファイル。 */
    llamaServer: string
    /** llama.cpp の共有ライブラリを置いたディレクトリ。 */
    llamaLibDir: string
    /** ページ画像の拡大率。 */
    pageScale: number
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
    instructions: '',
    // 既定では送らない。書いている途中の改行で送ってしまわないようにする。
    sendOnEnter: false,
    sendOnCtrlEnter: false,
  },
  ingest: {
    model: 'gpt-5.6-sol',
    // 照合と翻訳を model と effort を変えて実測した結果選んだ値(9 本の論文)。
    // effort を上げても翻訳は速度も品質も変わらず、照合は見出しの階層の
    // 再現がむしろ悪くなる組み合わせがあった。
    effort: 'low',
    serviceTier: null,
  },
  embedding: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'bge-m3',
    dimensions: 1024,
  },
  converter: {
    python: converterPython(),
    llamaServer: 'llama-server',
    llamaLibDir: '',
    pageScale: 2,
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
    // 空にできる値なので、長さでは判じない。
    if (typeof c['instructions'] === 'string') merged.chat.instructions = c['instructions']
    for (const key of ['sendOnEnter', 'sendOnCtrlEnter'] as const) {
      if (typeof c[key] === 'boolean') merged.chat[key] = c[key]
    }
  }

  const ingest = raw['ingest']
  if (typeof ingest === 'object' && ingest !== null) {
    const i = ingest as Record<string, unknown>
    if (i['serviceTier'] === null || typeof i['serviceTier'] === 'string') {
      merged.ingest.serviceTier = i['serviceTier'] as string | null
    }
    for (const key of ['model', 'effort'] as const) {
      const value = i[key]
      if (typeof value === 'string' && value.length > 0) merged.ingest[key] = value
    }
  }

  const embedding = raw['embedding']
  if (typeof embedding === 'object' && embedding !== null) {
    const e = embedding as Record<string, unknown>
    for (const key of ['baseUrl', 'model'] as const) {
      const value = e[key]
      if (typeof value === 'string' && value.length > 0) merged.embedding[key] = value
    }
    if (typeof e['dimensions'] === 'number' && Number.isInteger(e['dimensions']) && e['dimensions'] > 0) {
      merged.embedding.dimensions = e['dimensions']
    }
  }

  const converter = raw['converter']
  if (typeof converter === 'object' && converter !== null) {
    const c = converter as Record<string, unknown>
    for (const key of ['python', 'llamaServer', 'llamaLibDir'] as const) {
      const value = c[key]
      if (typeof value === 'string') merged.converter[key] = value
    }
    if (typeof c['pageScale'] === 'number' && c['pageScale'] > 0) {
      merged.converter.pageScale = c['pageScale']
    }
  }

  return merged
}

/**
 * コレクションの置き場所として使えない理由を返す。使えるなら null。
 *
 * 保存を通してしまうと、次に起動したサーバーがコレクションを読めない。書き込めるかは
 * 実際に確かめるしかないので、保存の前に見る。ここでは作らない。
 */
export async function unusableDataDir(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return '置き場所は絶対パスで指定する'

  const writable = async (target: string): Promise<boolean> => {
    try {
      await access(target, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  try {
    const found = await stat(path)
    if (!found.isDirectory()) return `ディレクトリではない: ${path}`
    if (!(await writable(path))) return `書き込めない: ${path}`
    return null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  // 無ければサーバーが作る。作れるかは親を見て判断する。
  const parent = dirname(path)
  try {
    if (!(await stat(parent)).isDirectory()) return `ディレクトリではない: ${parent}`
  } catch {
    return `親のディレクトリが無い: ${parent}`
  }
  if (!(await writable(parent))) return `書き込めない: ${parent}`
  return null
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
