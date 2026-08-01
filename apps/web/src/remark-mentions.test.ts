import assert from 'node:assert/strict'
import test from 'node:test'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { MENTION_SCHEME, remarkPaperMentions } from './remark-mentions.ts'

const KNOWN = new Set(['wang2026-himat', 'zhang2026-successive-height-preintegration'])

type Node = { type: string; value?: string; url?: string; children?: Node[] }

/** 実際の使われ方(unified の plugin として渡す)で通す。 */
function parse(markdown: string): Node {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkPaperMentions, { known: (slug: string) => KNOWN.has(slug) })
  return processor.runSync(processor.parse(markdown)) as unknown as Node
}

/** 構文木の中の参照の行き先を、出てくる順に並べる。 */
function mentions(node: Node): string[] {
  if (node.type === 'link' && node.url?.startsWith(MENTION_SCHEME) === true) {
    return [node.url.slice(MENTION_SCHEME.length)]
  }
  return (node.children ?? []).flatMap(mentions)
}

/** 参照として取り出した部分を除いて、残っている文字をつなぐ。 */
function text(node: Node): string {
  if (node.type === 'link' && node.url?.startsWith(MENTION_SCHEME) === true) return ''
  if (node.type === 'text') return node.value ?? ''
  if (node.type === 'inlineCode' || node.type === 'code') return node.value ?? ''
  return (node.children ?? []).map(text).join('')
}

test('地の文の @slug を参照にする', () => {
  const tree = parse('これは @wang2026-himat の話。')
  assert.deepEqual(mentions(tree), ['wang2026-himat'])
  assert.equal(text(tree), 'これは  の話。')
})

test('1 つの段落に複数あっても取る', () => {
  const tree = parse('@wang2026-himat と @zhang2026-successive-height-preintegration を比べる。')
  assert.deepEqual(mentions(tree), ['wang2026-himat', 'zhang2026-successive-height-preintegration'])
})

test('索引に無い slug は触らない', () => {
  const tree = parse('これは @nobody2020-unknown の話。')
  assert.deepEqual(mentions(tree), [])
  assert.equal(text(tree), 'これは @nobody2020-unknown の話。')
})

test('コードの中は触らない', () => {
  const tree = parse('`@wang2026-himat` は文字。\n\n```\n@wang2026-himat\n```\n')
  assert.deepEqual(mentions(tree), [])
})

test('表の中でも取る', () => {
  const tree = parse('| 論文 |\n|---|\n| @wang2026-himat |\n')
  assert.deepEqual(mentions(tree), ['wang2026-himat'])
})

test('リンクの行き先や文字は触らない', () => {
  const tree = parse('[@wang2026-himat](https://example.com/@wang2026-himat)')
  assert.deepEqual(mentions(tree), [])
})

test('メールの綴りは参照にしない', () => {
  const tree = parse('連絡は wang2026@himat へ。')
  assert.deepEqual(mentions(tree), [])
})
