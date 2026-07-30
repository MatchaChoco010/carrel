import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat, ChatMessage } from '../data/chat.ts'
import { toIsoDateTime } from '../data/datetime.ts'
import { buildDigestInput, parseDigest } from './digest.ts'

const AT = toIsoDateTime(new Date('2026-07-30T08:24:40+09:00'))

function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, at: AT, text }
}

function chat(options: {
  summary?: string
  titleSource?: 'auto' | 'user'
  messages: ChatMessage[]
}): Pick<Chat, 'meta' | 'messages'> {
  return {
    messages: options.messages,
    meta: {
      id: 'chats/2026/07/30/08-24-40-無題の会話.md',
      created: AT,
      updated: AT,
      title: '無題の会話',
      titleSource: options.titleSource ?? 'auto',
      summary: options.summary ?? '',
      archived: false,
      codexThreadId: null,
      model: null,
      effort: null,
      papers: [],
      forkedFrom: null,
    },
  }
}

test('渡すのは直近のやりとりだけで、古い発言は入れない', () => {
  const messages = Array.from({ length: 10 }, (_, i) => message(i % 2 === 0 ? 'user' : 'assistant', `発言${i}`))

  const input = buildDigestInput(chat({ messages }))

  assert.ok(input.includes('発言9'))
  assert.ok(input.includes('発言6'))
  assert.ok(!input.includes('発言5'))
})

test('既存の要約があれば入力に含める', () => {
  const input = buildDigestInput(chat({ summary: '位置エンコーディングの役割を確かめた。', messages: [message('user', 'あ')] }))

  assert.ok(input.includes('## いまの要約'))
  assert.ok(input.includes('位置エンコーディングの役割を確かめた。'))
})

test('要約が無いときは、その節を置かない', () => {
  const input = buildDigestInput(chat({ messages: [message('user', 'あ')] }))

  assert.ok(!input.includes('## いまの要約'))
})

test('ユーザーが付けたタイトルは出力させない', () => {
  const input = buildDigestInput(chat({ titleSource: 'user', messages: [message('user', 'あ')] }))

  assert.ok(input.includes('要約だけを出せ'))
})

test('長い発言は途中で切り、切ったことを伝える', () => {
  const input = buildDigestInput(chat({ messages: [message('assistant', 'あ'.repeat(3000))] }))

  assert.ok(input.includes('…(以下省略)'))
  assert.ok(input.length < 3000)
})

test('見出しで区切られたタイトルと要約を取り出す', () => {
  const parsed = parseDigest(
    ['## タイトル', '', 'NeRF の位置エンコーディング', '', '## 要約', '', '高周波の成分が失われる理由を確かめた。'].join('\n'),
  )

  assert.equal(parsed.title, 'NeRF の位置エンコーディング')
  assert.equal(parsed.summary, '高周波の成分が失われる理由を確かめた。')
})

test('節の外にある前置きは拾わない', () => {
  const parsed = parseDigest(['了解しました。以下が出力です。', '', '## タイトル', '', '題', '', '## 要約', '', '要約'].join('\n'))

  assert.equal(parsed.title, '題')
  assert.equal(parsed.summary, '要約')
})

test('コードフェンスで囲まれていても読める', () => {
  const parsed = parseDigest(['```markdown', '## タイトル', '', '題', '## 要約', '', '要約', '```'].join('\n'))

  assert.equal(parsed.title, '題')
  assert.equal(parsed.summary, '要約')
})

test('節が無いときは null を返す', () => {
  const parsed = parseDigest('タイトルは付けられません。')

  assert.equal(parsed.title, null)
  assert.equal(parsed.summary, null)
})

test('タイトルはファイル名に使えない文字を落とし、末尾の句点も落とす', () => {
  const parsed = parseDigest(['## タイトル', '', 'a/b:c?d の話。', '', '## 要約', '', 'x'].join('\n'))

  assert.equal(parsed.title, 'a b c d の話')
})

test('長いタイトルは 40 文字に収める', () => {
  const parsed = parseDigest(['## タイトル', '', 'あ'.repeat(60), '', '## 要約', '', 'x'].join('\n'))

  assert.equal(parsed.title?.length, 40)
})

test('要約は改行を畳んで 1 段落にする', () => {
  const parsed = parseDigest(['## タイトル', '', '題', '', '## 要約', '', '1 行目。', '2 行目。'].join('\n'))

  assert.equal(parsed.summary, '1 行目。 2 行目。')
})
