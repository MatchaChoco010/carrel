import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chatPathFor,
  newChatId,
  parseMessages,
  readChat,
  serializeMessages,
  withoutTurnIds,
  writeChat,
  type Chat,
  type ChatMessage,
} from './chat.ts'
import { toIsoDateTime } from './datetime.ts'

const AT = toIsoDateTime(new Date('2026-07-30T08:24:40+09:00'))
const TURN = '019fb103-f2e8-7ce3-98dd-43fcda467f7e'

test('応答の見出しから turn の識別子を読む', () => {
  const body = [`## user · ${AT}`, '', '質問', '', `## assistant · ${AT} · turn ${TURN}`, '', '応答'].join('\n')

  const messages = parseMessages(body)

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.turnId, undefined, 'ユーザーの発言には付かない')
  assert.equal(messages[1]?.turnId, TURN)
  assert.equal(messages[1]?.text, '応答')
})

test('識別子の無い見出しもそのまま読める', () => {
  const body = [`## assistant · ${AT}`, '', '応答'].join('\n')

  const messages = parseMessages(body)

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.turnId, undefined)
})

test('書き出した記録を読み直すと同じ発言になる', () => {
  const messages: ChatMessage[] = [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答', turnId: TURN },
  ]

  assert.deepEqual(parseMessages(serializeMessages(messages)), messages)
})

test('識別子を持たない発言の見出しには turn を書かない', () => {
  const text = serializeMessages([{ role: 'assistant', at: AT, text: '応答' }])

  assert.equal(text.includes('turn'), false)
})

test('本文に発言の見出しに似た行があっても区切りにしない', () => {
  const body = [`## assistant · ${AT} · turn ${TURN}`, '', '例を挙げる。', '', '## user · きのう', '', 'ここまで応答'].join(
    '\n',
  )

  const messages = parseMessages(body)

  assert.equal(messages.length, 1)
  assert.match(messages[0]?.text ?? '', /ここまで応答/)
})

test('識別子だけを落とし、本文と時刻は変えない', () => {
  const messages: ChatMessage[] = [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答', turnId: TURN },
  ]

  const dropped = withoutTurnIds(messages)

  assert.deepEqual(dropped, [
    { role: 'user', at: AT, text: '質問' },
    { role: 'assistant', at: AT, text: '応答' },
  ])
})

test('会話は識別子のディレクトリの中の chat.md に置く', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'carrel-chat-'))
  try {
    const at = new Date('2026-07-30T09:00:00+09:00')
    const id = '20260730T090000-abc123'

    assert.equal(chatPathFor(dir, at, id), 'chats/2026/07/30/20260730T090000-abc123/chat.md')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('タイトルを変えても置き場所は変わらない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'carrel-chat-'))
  try {
    const at = new Date('2026-07-30T09:00:00+09:00')
    const id = '20260730T090000-abc123'
    const created = '2026-07-30T09:00:00+09:00' as ChatMessage['at']
    const chat: Chat = {
      path: chatPathFor(dir, at, id),
      mtimeMs: 1,
      messages: [],
      meta: {
        id,
        created,
        updated: created,
        title: '無題の会話',
        titleSource: 'auto',
        summary: '',
        archived: false,
        codexThreadId: null,
        model: null,
        effort: null,
        papers: [],
        forkedFrom: null,
      },
    }
    await writeChat(dir, chat)

    const renamed: Chat = { ...chat, meta: { ...chat.meta, title: '位置エンコーディングの役割' } }
    await writeChat(dir, renamed)

    const read = await readChat(dir, join(dir, chat.path))
    assert.equal(read?.meta.title, '位置エンコーディングの役割')
    assert.equal(read?.path, chat.path, '置き場所は識別子だけで決まる')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('識別子は置き場所とタイトルを写さない', () => {
  const id = newChatId(new Date('2026-07-30T19:08:51+09:00'))

  assert.match(id, /^20260730T190851-[0-9a-f]{6}$/)
})

test('同じ時刻でも識別子は重ならない', () => {
  const at = new Date('2026-07-30T19:08:51+09:00')

  assert.notEqual(newChatId(at), newChatId(at))
})
