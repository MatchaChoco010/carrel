import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeWindow, mergeSnapshot, parseRateLimitSnapshot, toRateLimitView } from './rate-limits.ts'

// 実機の codex app-server が `account/rateLimits/read` に返した形。
const ACTUAL_RESPONSE = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1785649143 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'prolite',
    rateLimitReachedType: null,
  },
}

test('枠の呼び名を長さから導く', () => {
  assert.equal(describeWindow(300), '5 時間枠')
  assert.equal(describeWindow(10080), '週次枠')
  assert.equal(describeWindow(20160), '2 週間枠')
  assert.equal(describeWindow(1440), '日次枠')
  assert.equal(describeWindow(45), '45 分枠')
  assert.equal(describeWindow(null), '利用枠')
})

test('実機の応答を読み取れる', () => {
  const snapshot = parseRateLimitSnapshot(ACTUAL_RESPONSE)
  assert.ok(snapshot !== null)
  assert.deepEqual(snapshot.primary, { usedPercent: 20, resetsAt: 1785649143, windowDurationMins: 10080 })
  assert.equal(snapshot.secondary, null)
  assert.equal(snapshot.planType, 'prolite')
  assert.equal(snapshot.rateLimitReachedType, null)
})

test('primary が週次でも位置ではなく長さで呼ぶ', () => {
  const snapshot = parseRateLimitSnapshot(ACTUAL_RESPONSE)
  assert.ok(snapshot !== null)
  const view = toRateLimitView(snapshot)
  assert.equal(view.windows.length, 1)
  assert.equal(view.windows[0]?.label, '週次枠')
  assert.equal(view.nextResetAt, 1785649143)
  assert.equal(view.reached, false)
})

test('rateLimits で包まれていない形も読める', () => {
  const snapshot = parseRateLimitSnapshot(ACTUAL_RESPONSE.rateLimits)
  assert.ok(snapshot !== null)
  assert.equal(snapshot.planType, 'prolite')
})

test('上限への到達を種別で判定する', () => {
  const snapshot = parseRateLimitSnapshot({
    ...ACTUAL_RESPONSE.rateLimits,
    rateLimitReachedType: 'rate_limit_reached',
  })
  assert.ok(snapshot !== null)
  assert.equal(toRateLimitView(snapshot).reached, true)
  assert.equal(toRateLimitView(snapshot).reachedType, 'rate_limit_reached')
})

test('通知は差分なので、来ていない値で上書きしない', () => {
  const base = parseRateLimitSnapshot(ACTUAL_RESPONSE)
  assert.ok(base !== null)
  const partial = parseRateLimitSnapshot({ primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1 } })
  assert.ok(partial !== null)

  const merged = mergeSnapshot(base, partial)
  assert.equal(merged.primary?.usedPercent, 35)
  assert.equal(merged.planType, 'prolite')
  assert.deepEqual(merged.credits, { hasCredits: false, unlimited: false, balance: '0' })
})

test('上限への到達は差分でも解除できる', () => {
  const reached = parseRateLimitSnapshot({ ...ACTUAL_RESPONSE.rateLimits, rateLimitReachedType: 'rate_limit_reached' })
  const recovered = parseRateLimitSnapshot({ primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 2 } })
  assert.ok(reached !== null && recovered !== null)
  assert.equal(mergeSnapshot(reached, recovered).rateLimitReachedType, null)
})

test('複数の枠があれば最も早い回復時刻を返す', () => {
  const snapshot = parseRateLimitSnapshot({
    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 500 },
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 100 },
  })
  assert.ok(snapshot !== null)
  const view = toRateLimitView(snapshot)
  assert.deepEqual(view.windows.map((w) => w.label), ['5 時間枠', '週次枠'])
  assert.equal(view.nextResetAt, 100)
})

test('読めない値は null になる', () => {
  assert.equal(parseRateLimitSnapshot(null), null)
  assert.equal(parseRateLimitSnapshot('文字列'), null)
})
