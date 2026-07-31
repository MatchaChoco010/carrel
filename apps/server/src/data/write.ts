import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 同じディレクトリへ書いてから rename する。
 *
 * 書き込みの途中で読まれても、中途半端な内容を渡さないようにする。
 */
export async function writeAtomicFile(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${Date.now()}.${process.pid}.tmp`)
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}
