import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paperAssetsDir, paperDir, paperFile, paperPagesDir } from '../data/layout.ts'
import { buildBody } from './document.ts'
import type { ConvertedDocument } from './types.ts'

/** `paper.raw.md` から図を参照するときの、論文ディレクトリからの相対の場所。 */
export const ASSETS_DIR_NAME = 'assets'

/** ブロックとページの対応。照合がページ画像と組にするのに使う(0004)。 */
const BLOCKS_FILE = 'blocks.json'

export function paperBlocksFile(dataDir: string, slug: string): string {
  return join(paperDir(dataDir, slug), BLOCKS_FILE)
}

/**
 * 変換器の成果物を論文のディレクトリへ移す。
 *
 * 変換器には作業用のディレクトリへ書かせ、成功したものだけをここで移す。
 * 途中で失敗した成果物が論文のディレクトリに残ると、完了した段階の判定
 * (成果物の存在で決まる)が狂うためである。
 */
export async function storeConversion(
  dataDir: string,
  slug: string,
  workDir: string,
  document: ConvertedDocument,
): Promise<void> {
  const assets = paperAssetsDir(dataDir, slug)
  const pages = paperPagesDir(dataDir, slug)
  await rm(assets, { recursive: true, force: true })
  await rm(pages, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await mkdir(pages, { recursive: true })

  await copyDir(join(workDir, 'assets'), assets)
  await copyDir(join(workDir, 'pages'), pages)

  await writeFile(paperBlocksFile(dataDir, slug), `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  // 本文は最後に書く。これが変換の段階の完了を表す成果物になる(0004)。
  await writeFile(paperFile(dataDir, slug, 'raw'), buildBody(document, ASSETS_DIR_NAME), 'utf8')
}

async function copyDir(from: string, to: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(from)
  } catch {
    return
  }
  for (const name of entries) {
    await cp(join(from, name), join(to, name))
  }
}
