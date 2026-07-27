import { VFile } from 'vfile'
import { matter } from 'vfile-matter'
import { stringify } from 'yaml'

export type Document = {
  meta: Record<string, unknown>
  body: string
}

const FENCE = '---'

/**
 * 先頭の frontmatter を本文から切り離す。
 *
 * 解析は vfile-matter に任せる。YAML 1.2 の `yaml` を使うため、日時が文字列の
 * まま保たれる(YAML 1.1 の実装は `Date` へ変換し、書き戻しでオフセットを失う)。
 */
export function splitDocument(text: string): Document {
  const file = new VFile(text.startsWith('﻿') ? text.slice(1) : text)
  matter(file, { strip: true })

  const parsed: unknown = file.data.matter
  const meta =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}

  const body = String(file)
  return { meta, body: body.startsWith('\n') ? body.slice(1) : body }
}

export function joinDocument(document: Document): string {
  const body = document.body.replace(/^\n+/, '')
  if (Object.keys(document.meta).length === 0) {
    return body.endsWith('\n') || body.length === 0 ? body : `${body}\n`
  }
  const yamlText = stringify(document.meta, { lineWidth: 0 }).trimEnd()
  const trailing = body.endsWith('\n') || body.length === 0 ? '' : '\n'
  return `${FENCE}\n${yamlText}\n${FENCE}\n\n${body}${trailing}`
}
