import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatAssetsDirOf } from '../data/layout.ts'

/** 受け取る画像の形式(0013)。 */
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

export type IncomingImage = {
  /** 元のファイル名。貼り付けた画像には無いことがある。 */
  name: string
  type: string
  bytes: Uint8Array
}

export type StoredImage = {
  /** 記録に残す参照。会話の本文からの相対(0013)。 */
  ref: string
  /** 実体の場所。Codex へはこちらを渡す。 */
  file: string
  name: string
}

export function unsupportedImageType(type: string): boolean {
  return EXTENSIONS[type] === undefined
}

/**
 * 添付を会話のディレクトリへ置く(0013)。
 *
 * 名前は中身のハッシュなので、同じ画像を二度貼っても実体は 1 つになる。
 */
export async function storeImages(chatFilePath: string, images: IncomingImage[]): Promise<StoredImage[]> {
  if (images.length === 0) return []

  const dir = chatAssetsDirOf(chatFilePath)
  await mkdir(dir, { recursive: true })

  const stored: StoredImage[] = []
  for (const image of images) {
    const extension = EXTENSIONS[image.type]
    if (extension === undefined) throw new Error(`扱わない形式: ${image.type}`)
    const name = `${createHash('sha256').update(image.bytes).digest('hex').slice(0, 12)}${extension}`
    const file = join(dir, name)
    await writeFile(file, image.bytes)
    stored.push({ ref: `assets/${name}`, file, name: image.name })
  }
  return stored
}

/** 添付の参照を本文の先頭に並べる(0013)。 */
export function withAttachments(text: string, images: StoredImage[]): string {
  if (images.length === 0) return text
  const refs = images.map((image) => `![${image.name}](${image.ref})`).join('\n')
  return text.length === 0 ? refs : `${refs}\n\n${text}`
}
