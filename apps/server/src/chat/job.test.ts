import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChatDigestScheduler } from './job.ts'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('静かになってから 1 度だけ積む', async () => {
  const ran: string[] = []
  const scheduler = new ChatDigestScheduler({ quietMs: 20, run: (path) => ran.push(path) })

  scheduler.touch('a.md')
  await wait(60)

  assert.deepEqual(ran, ['a.md'])
})

test('待っている間に次のターンが完了したら待ち直す', async () => {
  const ran: string[] = []
  const scheduler = new ChatDigestScheduler({ quietMs: 40, run: (path) => ran.push(path) })

  scheduler.touch('a.md')
  await wait(20)
  scheduler.touch('a.md')
  await wait(30)

  assert.deepEqual(ran, [], '待ち直した後なので、まだ積まれていない')

  await wait(40)
  assert.deepEqual(ran, ['a.md'])
})

test('会話ごとに別々に待つ', async () => {
  const ran: string[] = []
  const scheduler = new ChatDigestScheduler({ quietMs: 20, run: (path) => ran.push(path) })

  scheduler.touch('a.md')
  scheduler.touch('b.md')
  await wait(60)

  assert.deepEqual(ran.sort(), ['a.md', 'b.md'])
})

test('取り消した会話は積まれない', async () => {
  const ran: string[] = []
  const scheduler = new ChatDigestScheduler({ quietMs: 20, run: (path) => ran.push(path) })

  scheduler.touch('a.md')
  scheduler.cancel('a.md')
  await wait(60)

  assert.deepEqual(ran, [])
})

test('止めると待っているものが全部消える', async () => {
  const ran: string[] = []
  const scheduler = new ChatDigestScheduler({ quietMs: 20, run: (path) => ran.push(path) })

  scheduler.touch('a.md')
  scheduler.touch('b.md')
  scheduler.stop()
  await wait(60)

  assert.deepEqual(ran, [])
})
