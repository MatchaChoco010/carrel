import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Chat, ChatMessage } from '../data/chat.ts'
import { toIsoDateTime } from '../data/datetime.ts'
import { IndexDb } from '../db/index-db.ts'
import { buildChatChunks } from './chat-register.ts'
import { searchChats } from './chat-search.ts'
import { ChatChunkStore } from './chat-store.ts'
import type { Embedder } from './embed.ts'

/** 語が一致するほど近くなる、決まった値を返す埋め込み。 */
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Float32Array(4)
    v[0] = t.includes('ガウシアン') ? 1 : 0
    v[1] = t.includes('位置エンコーディング') ? 1 : 0
    v[2] = t.includes('メッシュ') ? 1 : 0
    v[3] = 0.01
    return v
  })

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pct-chat-search-'))
  const index = new IndexDb(join(root, 'index.sqlite'))
  const chunks = new ChatChunkStore(index.db)
  return { root, index, chunks, close: () => (index.close(), rmSync(root, { recursive: true, force: true })) }
}

const AT = toIsoDateTime(new Date('2026-07-30T09:00:00+09:00'))

function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, at: AT, text }
}

function chat(options: {
  id: string
  updated?: string
  archived?: boolean
  title?: string
  messages: ChatMessage[]
}): Chat {
  return {
    path: `chats/2026/07/30/${options.id}.md`,
    mtimeMs: 1,
    messages: options.messages,
    meta: {
      id: options.id,
      created: AT,
      updated: (options.updated ?? AT) as Chat['meta']['updated'],
      title: options.title ?? '会話',
      titleSource: 'auto',
      summary: '',
      archived: options.archived ?? false,
      codexThreadId: null,
      model: null,
      effort: null,
      papers: [],
      forkedFrom: null,
    },
  }
}

async function add(h: ReturnType<typeof harness>, target: Chat): Promise<void> {
  h.index.upsertChat(target)
  h.chunks.replace(target.meta.id, await buildChatChunks(target, new Map(), fakeEmbed))
}

test('発言の本文に当たった会話を返し、当たった発言を抜粋にする', async () => {
  const h = harness()
  try {
    await add(
      h,
      chat({
        id: 'a',
        title: '3DGS の話',
        messages: [message('user', '描画の速さについて'), message('assistant', 'ガウシアンを投影して合成する')],
      }),
    )
    await add(h, chat({ id: 'b', title: '別の話', messages: [message('user', 'メッシュの簡略化について')] }))

    const hits = await searchChats({ text: 'ガウシアン' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })

    assert.equal(hits.length, 2, '両方の会話がベクトル検索の候補には入る')
    assert.equal(hits[0]?.id, 'a')
    assert.equal(hits[0]?.title, '3DGS の話')
    assert.equal(hits[0]?.role, 'assistant')
    assert.match(hits[0]?.excerpt ?? '', /ガウシアン/)
  } finally {
    h.close()
  }
})

test('会話ごとに 1 件にまとめる', async () => {
  const h = harness()
  try {
    await add(
      h,
      chat({
        id: 'a',
        messages: [message('user', 'ガウシアンの話'), message('assistant', 'ガウシアンについて答える')],
      }),
    )

    const hits = await searchChats({ text: 'ガウシアン' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })

    assert.equal(hits.length, 1)
  } finally {
    h.close()
  }
})

test('アーカイブ状態で絞る', async () => {
  const h = harness()
  try {
    await add(h, chat({ id: 'a', messages: [message('user', 'ガウシアンの話')] }))
    await add(h, chat({ id: 'b', archived: true, messages: [message('user', 'ガウシアンの話')] }))

    const active = await searchChats(
      { text: 'ガウシアン', archived: false },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )
    const archived = await searchChats(
      { text: 'ガウシアン', archived: true },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )

    assert.deepEqual(
      active.map((hit) => hit.id),
      ['a'],
    )
    assert.deepEqual(
      archived.map((hit) => hit.id),
      ['b'],
    )
  } finally {
    h.close()
  }
})

test('日付の範囲で絞る', async () => {
  const h = harness()
  try {
    await add(h, chat({ id: 'old', updated: '2026-06-01T09:00:00+09:00', messages: [message('user', 'ガウシアン')] }))
    await add(h, chat({ id: 'new', updated: '2026-07-30T09:00:00+09:00', messages: [message('user', 'ガウシアン')] }))

    const hits = await searchChats(
      { text: 'ガウシアン', from: '2026-07-01T00:00:00+09:00' },
      { index: h.index, chunks: h.chunks, embed: fakeEmbed },
    )

    assert.deepEqual(
      hits.map((hit) => hit.id),
      ['new'],
    )
  } finally {
    h.close()
  }
})

test('語句が無いときは条件に当たった会話をそのまま並べる', async () => {
  const h = harness()
  try {
    await add(h, chat({ id: 'a', messages: [message('user', 'あ')] }))
    await add(h, chat({ id: 'b', archived: true, messages: [message('user', 'い')] }))

    const hits = await searchChats({ archived: true }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })

    assert.deepEqual(
      hits.map((hit) => hit.id),
      ['b'],
    )
    assert.equal(hits[0]?.role, null, '当たった発言が無いので役割は付かない')
  } finally {
    h.close()
  }
})

test('索引に無い会話は結果に出ない', async () => {
  const h = harness()
  try {
    const target = chat({ id: 'a', messages: [message('user', 'ガウシアンの話')] })
    await add(h, target)
    h.index.deleteChatByPath(target.path)

    const hits = await searchChats({ text: 'ガウシアン' }, { index: h.index, chunks: h.chunks, embed: fakeEmbed })

    assert.deepEqual(hits, [])
  } finally {
    h.close()
  }
})

test('本文が変わっていない発言は埋め込みを作り直さない', async () => {
  const asked: string[] = []
  const counting: Embedder = async (texts) => {
    asked.push(...texts)
    return fakeEmbed(texts)
  }
  const target = chat({ id: 'a', messages: [message('user', '最初の発言'), message('assistant', '最初の応答')] })

  const first = await buildChatChunks(target, new Map(), counting)
  const known = new Map(first.map((chunk) => [chunk.text, chunk.vector as Float32Array]))
  asked.length = 0

  const grown = { messages: [...target.messages, message('user', '次の発言')] }
  const second = await buildChatChunks(grown, known, counting)

  assert.deepEqual(asked, ['次の発言'])
  assert.equal(second.length, 3)
  assert.ok(second.every((chunk) => chunk.vector !== null))
})

test('空の発言はチャンクにしない', async () => {
  const chunks = await buildChatChunks(
    { messages: [message('user', 'あ'), message('assistant', '   ')] },
    new Map(),
    fakeEmbed,
  )

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.role, 'user')
})
