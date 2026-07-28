import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildFigures } from './figures.ts'
import type { Bbox, BlockKind, ConvertedBlock, ConvertedDocument } from './types.ts'

export type ConverterPaths = {
  /** venv の python。 */
  python: string
  /** 変換スクリプト。 */
  script: string
  /** llama.cpp の server 実行ファイル。 */
  llamaServer: string
  /** llama.cpp の共有ライブラリを置いたディレクトリ。 */
  llamaLibDir: string
}

export type RunConvertOptions = {
  pdf: string
  /** 成果物を書く場所。document.json / assets/ / pages/ ができる。 */
  outDir: string
  paths: ConverterPaths
  signal?: AbortSignal
}

const BLOCK_KINDS = new Set<BlockKind>([
  'text',
  'sectionHeader',
  'listItem',
  'caption',
  'figure',
  'table',
  'equation',
  'code',
  'footnote',
  'reference',
  'pageHeader',
  'pageFooter',
  'pageNumber',
  'other',
])

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseBbox(value: unknown): Bbox {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    x0: asNumber(raw['x0']),
    y0: asNumber(raw['y0']),
    x1: asNumber(raw['x1']),
    y1: asNumber(raw['y1']),
  }
}

function parseBlock(value: unknown): ConvertedBlock | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const id = asString(raw['id'])
  if (id.length === 0) return null
  const kind = asString(raw['kind']) as BlockKind
  const image = raw['image']
  const groupId = raw['groupId']
  return {
    id,
    kind: BLOCK_KINDS.has(kind) ? kind : 'other',
    page: Math.max(0, Math.trunc(asNumber(raw['page']))),
    bbox: parseBbox(raw['bbox']),
    markdown: asString(raw['markdown']),
    image: typeof image === 'string' && image.length > 0 ? image : null,
    groupId: typeof groupId === 'string' && groupId.length > 0 ? groupId : null,
  }
}

/** 変換器が書いた document.json を読み、契約の形に整える。 */
export function parseDocument(text: string): ConvertedDocument {
  const raw = JSON.parse(text) as Record<string, unknown>
  const blocks = Array.isArray(raw['blocks'])
    ? raw['blocks'].map(parseBlock).filter((b): b is ConvertedBlock => b !== null)
    : []
  const pageCount = Math.max(0, Math.trunc(asNumber(raw['pageCount'])))
  if (pageCount === 0) throw new Error('変換器がページ数を返さなかった')
  return { pageCount, blocks, figures: buildFigures(blocks) }
}

/**
 * 変換器を子プロセスとして走らせる。
 *
 * モードと推論バックエンドと装置は変換スクリプト側で決まる。ここで渡すのは、
 * その機械にしか無い実行ファイルの場所だけである。
 */
export function runConverter(options: RunConvertOptions): Promise<ConvertedDocument> {
  const { pdf, outDir, paths, signal } = options
  return new Promise((resolve, reject) => {
    const child = spawn(paths.python, [paths.script, pdf, outDir], {
      env: {
        ...process.env,
        LLAMA_CPP_BINARY: paths.llamaServer,
        LD_LIBRARY_PATH: paths.llamaLibDir,
        // 画面を描いている iGPU ではなく dGPU を使う。
        ROCR_VISIBLE_DEVICES: process.env['ROCR_VISIBLE_DEVICES'] ?? '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    })

    // 進捗の行が大量に出るため、失敗したときの手がかりとして末尾だけ残す。
    let tail = ''
    const keepTail = (chunk: Buffer): void => {
      tail = `${tail}${chunk.toString('utf8')}`.slice(-4000)
    }
    child.stdout.on('data', keepTail)
    child.stderr.on('data', keepTail)

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`変換器が異常終了した (code=${code})\n${tail.trimEnd()}`))
        return
      }
      readFile(join(outDir, 'document.json'), 'utf8')
        .then((text) => resolve(parseDocument(text)))
        .catch(reject)
    })
  })
}
