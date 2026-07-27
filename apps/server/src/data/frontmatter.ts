import { parse, stringify } from 'yaml'

export type Document = {
  meta: Record<string, unknown>
  body: string
}

const FENCE = '---'

/**
 * 先頭の `---` で囲まれた YAML を本文から切り離す。
 *
 * frontmatter が無いファイルも読めるようにする。手で置いた markdown や、
 * 本文だけを持つ副次ファイルが対象になるため。
 */
export function splitDocument(text: string): Document {
  const normalized = text.startsWith('﻿') ? text.slice(1) : text
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== FENCE) {
    return { meta: {}, body: normalized }
  }

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === FENCE)
  if (end === -1) {
    return { meta: {}, body: normalized }
  }

  const yamlText = lines.slice(1, end).join('\n')
  const body = lines.slice(end + 1).join('\n')
  const parsed: unknown = yamlText.trim().length > 0 ? parse(yamlText) : {}
  const meta = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}

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
