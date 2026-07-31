import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { looksLikePdf } from './fetch.ts'

/**
 * 手元から上げた原本を、slug が決まるまで預かる場所。
 *
 * コレクションに置くのは論文と会話だけで(0002)、slug の決まっていない原本は
 * どちらでもない。状態のディレクトリの下に持つ(0021)。
 */
export function uploadsDir(stateDir: string): string {
  return join(stateDir, 'uploads')
}

function pdfPath(stateDir: string, id: string): string {
  return join(uploadsDir(stateDir), `${id}.pdf`)
}

function namePath(stateDir: string, id: string): string {
  return join(uploadsDir(stateDir), `${id}.name`)
}

/** 1 本の原本として受け取る上限。取得の段階と同じにする(0021)。 */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** 預かった原本が残ってよい長さ。取り込みに使われないまま溜まるのを防ぐ。 */
export const STALE_MS = 24 * 60 * 60 * 1000

export type StagedOriginal = {
  id: string
  /** 選ばれたファイルの名前。取り込みの記録と一覧に出す。 */
  name: string
  path: string
  bytes: number
}

/**
 * 上げられたファイルの名前を、置き場に書ける形に均す。
 *
 * 名前は表示のためだけに持つので、経路として意味を持つ文字は落とす。
 */
export function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/')).trim()
  const cleaned = base.replace(/[\u0000-\u001f\u007f/]/g, '').slice(0, 200)
  return cleaned.length > 0 ? cleaned : 'original.pdf'
}

export type StageOptions = {
  /** 受け取る上限。試験からは小さい値を渡す。 */
  maxBytes?: number
  /** 置き場に使う識別子。既定は無作為に振る。 */
  id?: string
}

/**
 * 上げられた原本を置き場へ流し込む。
 *
 * 丸ごとメモリに載せずに書く。数百 MB の PDF がそのまま常駐メモリの山になるためである。
 * 先頭が PDF の印で始まらないものは、書き終わる前に断る。
 */
export async function stageOriginal(
  stateDir: string,
  name: string,
  body: Readable | ReadableStream<Uint8Array>,
  options: StageOptions = {},
): Promise<StagedOriginal> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES
  const id = options.id ?? crypto.randomUUID()
  await mkdir(uploadsDir(stateDir), { recursive: true })
  const path = pdfPath(stateDir, id)

  let bytes = 0
  let head: Buffer | null = null
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (head === null) {
        head = chunk.subarray(0, 8)
        if (chunk.byteLength >= 5 && !looksLikePdf(chunk)) {
          done(new Error('PDF ではないものが送られた'))
          return
        }
      }
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        done(new Error(`原本が大きすぎる (${maxBytes} バイトを超えた)`))
        return
      }
      done(null, chunk)
    },
  })

  const source = body instanceof Readable ? body : Readable.fromWeb(body)
  try {
    await pipeline(source, check, createWriteStream(path))
    if (head === null || !looksLikePdf(head)) throw new Error('PDF ではないものが送られた')
  } catch (error) {
    // 途中まで書いたものを残すと、置き場が壊れた PDF で埋まる。
    await rm(path, { force: true })
    throw error
  }

  const stored = safeName(name)
  await writeFile(namePath(stateDir, id), stored, 'utf8')
  return { id, name: stored, path, bytes }
}

/** 預かっている原本を引く。無ければ null を返す。 */
export async function readStaged(stateDir: string, id: string): Promise<StagedOriginal | null> {
  const path = pdfPath(stateDir, id)
  try {
    const [info, name] = await Promise.all([stat(path), readFile(namePath(stateDir, id), 'utf8')])
    return { id, name, path, bytes: info.size }
  } catch {
    return null
  }
}

/** 預かっている原本を捨てる。コレクションへ移した後と、取り込みが始まらなかったときに呼ぶ。 */
export async function removeStaged(stateDir: string, id: string): Promise<void> {
  await Promise.all([rm(pdfPath(stateDir, id), { force: true }), rm(namePath(stateDir, id), { force: true })])
}

/**
 * 取り込みに使われないまま古くなった原本を捨てる。
 *
 * 上げた後にアプリを閉じると、置き場のファイルを消す者がいなくなる。起動のときに掃く。
 */
export async function sweepStaged(stateDir: string, now = Date.now(), staleMs = STALE_MS): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(uploadsDir(stateDir))
  } catch {
    return 0
  }

  let removed = 0
  for (const entry of entries) {
    if (!entry.endsWith('.pdf')) continue
    const id = entry.slice(0, -'.pdf'.length)
    const path = pdfPath(stateDir, id)
    try {
      const info = await stat(path)
      if (now - info.mtimeMs < staleMs) continue
    } catch {
      continue
    }
    await removeStaged(stateDir, id)
    removed += 1
  }
  return removed
}
