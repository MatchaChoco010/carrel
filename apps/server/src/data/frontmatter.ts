import matter from 'gray-matter'
import { parse, stringify } from 'yaml'

export type Document = {
  meta: Record<string, unknown>
  body: string
}

const FENCE = '---'

// gray-matter の既定のエンジンは YAML 1.1 で、日時を Date へ変換する。書き戻すと
// ファイルに書かれたオフセットが UTC へ畳まれるため、YAML 1.2 の yaml に差し替える。
const OPTIONS = {
  engines: {
    yaml: {
      parse: (input: string): object => {
        const value: unknown = parse(input)
        return typeof value === 'object' && value !== null ? value : {}
      },
      stringify: (input: object): string => stringify(input),
    },
  },
}

/**
 * 先頭の frontmatter を本文から切り離す。
 *
 * `$CARREL_DATA` は人が触るので、YAML として壊れているファイルが混ざりうる。
 * その場合は例外にせず、frontmatter が無いものとして本文だけを返す。
 * 走査の途中で 1 ファイルのために全体が止まらないようにする。
 */
export function splitDocument(text: string): Document {
  const normalized = text.startsWith('﻿') ? text.slice(1) : text

  let data: unknown
  let content: string
  try {
    const parsed = matter(normalized, OPTIONS)
    data = parsed.data
    content = parsed.content
  } catch {
    return { meta: {}, body: normalized }
  }

  const meta =
    typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {}

  return { meta, body: content.startsWith('\n') ? content.slice(1) : content }
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
