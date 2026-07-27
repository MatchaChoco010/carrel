import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isIsoDateTime, parseIsoDateTime, toEpochMs, toIsoDateTime } from './datetime.ts'

test('オフセット付きの日時だけを受け付ける', () => {
  assert.equal(isIsoDateTime('2026-07-27T15:04:12+09:00'), true)
  assert.equal(isIsoDateTime('2026-07-27T06:04:12Z'), true)
  assert.equal(isIsoDateTime('2026-07-27T15:04:12.500+09:00'), true)
})

test('オフセットの無い値や日付だけの値は受け付けない', () => {
  assert.equal(isIsoDateTime('2026-07-27'), false)
  assert.equal(isIsoDateTime('2026-07-27T15:04:12'), false)
  assert.equal(isIsoDateTime('2026/07/27 15:04'), false)
  assert.equal(isIsoDateTime(''), false)
  assert.equal(isIsoDateTime(1753600000000), false)
  assert.equal(isIsoDateTime(new Date()), false)
})

test('形は合っていても実在しない日時は受け付けない', () => {
  assert.equal(isIsoDateTime('2026-13-45T99:99:99+09:00'), false)
})

test('受け付けない値は null になる', () => {
  assert.equal(parseIsoDateTime('2026-07-27'), null)
  assert.equal(parseIsoDateTime(undefined), null)
  assert.equal(parseIsoDateTime('2026-07-27T15:04:12+09:00'), '2026-07-27T15:04:12+09:00')
})

test('現地時刻のオフセットを保つ', () => {
  const value = toIsoDateTime(new Date('2026-07-27T06:04:12Z'))
  assert.equal(isIsoDateTime(value), true)
  // Date へ通しても指す時刻は変わらない。
  assert.equal(toEpochMs(value), Date.parse('2026-07-27T06:04:12Z'))
  // UTC へ畳まず、オフセットを持った表記になる。
  assert.match(value, /(Z|[+-]\d{2}:\d{2})$/)
})

test('比較のために数値へ落とせる', () => {
  const older = parseIsoDateTime('2026-07-27T15:04:12+09:00')
  const newer = parseIsoDateTime('2026-07-27T15:04:13+09:00')
  assert.ok(older !== null && newer !== null)
  assert.ok(toEpochMs(older) < toEpochMs(newer))
})

test('同じ時刻を別のオフセットで書いても指す時刻は等しい', () => {
  const jst = parseIsoDateTime('2026-07-27T15:04:12+09:00')
  const utc = parseIsoDateTime('2026-07-27T06:04:12Z')
  assert.ok(jst !== null && utc !== null)
  assert.equal(toEpochMs(jst), toEpochMs(utc))
})
