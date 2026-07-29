import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StateDb } from '../db/state-db.ts'
import { buildSearchUrl } from './arxiv.ts'
import { pollFeed } from './poll.ts'
import { FeedStore } from './store.ts'

type Harness = { feed: FeedStore; close: () => void }

function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'pct-feed-'))
  const state = new StateDb(join(root, 'state.sqlite'))
  return {
    feed: new FeedStore(state.db),
    close: () => {
      state.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** entry を 1 件だけ持つ応答。 */
function entry(id: string, title: string, published: string): string {
  return `<entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <title>${title}</title>
    <summary>abstract of ${title}</summary>
    <published>${published}</published>
    <author><name>Someone</name></author>
  </entry>`
}

/** 問い合わせ文字列を読める形に戻す。URLSearchParams は空白を `+` にする。 */
function readable(url: string): string {
  return decodeURIComponent(url).replace(/\+/g, ' ')
}

function respond(body: string): { ok: boolean; status: number; text: () => Promise<string> } {
  return { ok: true, status: 200, text: async () => body }
}

test('投稿日時の範囲を指定して問い合わせる', () => {
  const url = buildSearchUrl('cs.GR', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-03T12:34:00Z'), 0)

  assert.match(readable(url), /cat:cs\.GR AND submittedDate:\[202607010000 TO 202607031234\]/)
  assert.match(url, /sortBy=submittedDate/)
})

test('取った項目が未読で入り、次の起点が最も新しい投稿時刻になる', async () => {
  const h = makeHarness()
  try {
    const results = await pollFeed({
      feed: h.feed,
      categories: ['cs.GR'],
      initialLookbackDays: 3,
      now: () => Date.parse('2026-07-30T00:00:00Z'),
      fetcher: async () =>
        respond(
          `<feed>${entry('2607.00001', '古いほう', '2026-07-28T10:00:00Z')}${entry('2607.00002', '新しいほう', '2026-07-29T10:00:00Z')}</feed>`,
        ),
    })

    assert.deepEqual(results, [{ category: 'cs.GR', fetched: 2, added: 2 }])
    assert.equal(h.feed.unreadCount(), 2)
    assert.equal(h.feed.cursor('cs.GR'), Date.parse('2026-07-29T10:00:00Z'))
    assert.deepEqual(
      h.feed.list().map((i) => i.title),
      ['新しいほう', '古いほう'],
    )
  } finally {
    h.close()
  }
})

test('記録が無ければ既定の遡り期間から取る', async () => {
  const h = makeHarness()
  const urls: string[] = []
  try {
    await pollFeed({
      feed: h.feed,
      categories: ['cs.GR'],
      initialLookbackDays: 3,
      now: () => Date.parse('2026-07-30T00:00:00Z'),
      fetcher: async (url) => {
        urls.push(url)
        return respond('<feed></feed>')
      },
    })

    assert.match(readable(urls[0] as string), /submittedDate:\[202607270000 TO 202607300000\]/)
  } finally {
    h.close()
  }
})

test('記録があればそこから取る', async () => {
  const h = makeHarness()
  const urls: string[] = []
  try {
    h.feed.setCursor('cs.GR', Date.parse('2026-07-20T09:00:00Z'))
    await pollFeed({
      feed: h.feed,
      categories: ['cs.GR'],
      initialLookbackDays: 3,
      now: () => Date.parse('2026-07-30T00:00:00Z'),
      fetcher: async (url) => {
        urls.push(url)
        return respond('<feed></feed>')
      },
    })

    assert.match(readable(urls[0] as string), /submittedDate:\[202607200900 TO 202607300000\]/)
  } finally {
    h.close()
  }
})

test('版が上がっただけの再投稿は新着にしない', async () => {
  const h = makeHarness()
  try {
    const fetcher = async (): Promise<ReturnType<typeof respond>> =>
      respond(`<feed>${entry('2607.00001', '同じ論文', '2026-07-28T10:00:00Z')}</feed>`)
    const options = {
      feed: h.feed,
      categories: ['cs.GR'],
      initialLookbackDays: 3,
      now: () => Date.parse('2026-07-30T00:00:00Z'),
      fetcher,
    }

    await pollFeed(options)
    const again = await pollFeed(options)

    assert.equal(again[0]?.added, 0)
    assert.equal(h.feed.list().length, 1)
  } finally {
    h.close()
  }
})

test('画面に出た項目を既読にすると未読数が減る', async () => {
  const h = makeHarness()
  try {
    await pollFeed({
      feed: h.feed,
      categories: ['cs.GR'],
      initialLookbackDays: 3,
      now: () => Date.parse('2026-07-30T00:00:00Z'),
      fetcher: async () =>
        respond(
          `<feed>${entry('2607.00001', 'A', '2026-07-28T10:00:00Z')}${entry('2607.00002', 'B', '2026-07-29T10:00:00Z')}</feed>`,
        ),
    })

    assert.equal(h.feed.markRead(['2607.00001']), 1)
    assert.equal(h.feed.unreadCount(), 1)
    // 二度目は既読なので減らない。
    assert.equal(h.feed.markRead(['2607.00001']), 0)
  } finally {
    h.close()
  }
})
