import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  freeChatPath,
  parseMessages,
  readChat,
  renameChatToTitle,
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

test('ファイル名をタイトルに合わせて付け直す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pct-rename-'))
  try {
    const created = '2026-07-30T09:00:00+09:00' as ChatMessage['at']
    const chat: Chat = {
      path: 'chats/2026/07/30/09-00-00-無題の会話.md',
      mtimeMs: 1,
      messages: [{ role: 'user', at: created, text: 'あ' }],
      meta: {
        id: 'chats/2026/07/30/09-00-00-無題の会話.md',
        created,
        updated: created,
        title: '位置エンコーディングの役割',
        titleSource: 'user',
        summary: '',
        archived: false,
        codexThreadId: null,
        model: null,
        effort: null,
        papers: [],
        forkedFrom: null,
      },
    }
    await mkdir(join(dir, 'chats/2026/07/30'), { recursive: true })
    await writeChat(dir, chat)

    const path = await renameChatToTitle(dir, chat)

    assert.equal(path, 'chats/2026/07/30/09-00-00-位置エンコーディングの役割.md')
    const moved = await readChat(dir, join(dir, path))
    assert.equal(moved?.meta.title, '位置エンコーディングの役割')
    assert.equal(moved?.meta.id, chat.meta.id, '識別子は動かさない')
    await assert.rejects(() => readFile(join(dir, chat.path), 'utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('題が同じなら動かさない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pct-rename-'))
  try {
    const created = '2026-07-30T09:00:00+09:00' as ChatMessage['at']
    const path = 'chats/2026/07/30/09-00-00-そのままの題.md'
    const chat: Chat = {
      path,
      mtimeMs: 1,
      messages: [],
      meta: {
        id: path,
        created,
        updated: created,
        title: 'そのままの題',
        titleSource: 'user',
        summary: '',
        archived: false,
        codexThreadId: null,
        model: null,
        effort: null,
        papers: [],
        forkedFrom: null,
      },
    }
    await mkdir(join(dir, 'chats/2026/07/30'), { recursive: true })
    await writeChat(dir, chat)

    assert.equal(await renameChatToTitle(dir, chat), path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('同じ秒に同じ題の会話があれば連番を付ける', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pct-rename-'))
  try {
    const at = new Date('2026-07-30T09:00:00+09:00')
    await mkdir(join(dir, 'chats/2026/07/30'), { recursive: true })
    await writeFile(join(dir, 'chats/2026/07/30/09-00-00-同じ題.md'), 'x', 'utf8')

    assert.equal(await freeChatPath(dir, at, '同じ題'), 'chats/2026/07/30/09-00-00-同じ題-2.md')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('自分の置き場所は衝突として数えない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pct-rename-'))
  try {
    const at = new Date('2026-07-30T09:00:00+09:00')
    const path = 'chats/2026/07/30/09-00-00-同じ題.md'
    await mkdir(join(dir, 'chats/2026/07/30'), { recursive: true })
    await writeFile(join(dir, path), 'x', 'utf8')

    assert.equal(await freeChatPath(dir, at, '同じ題', path), path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
