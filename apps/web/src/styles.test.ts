import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8')

/**
 * 括弧が閉じていないと、そこから後ろの規則がすべて 1 つずつずれて死ぬ。
 * 画面は崩れるがビルドは通るので、ここで見つける。
 */
test('波括弧が釣り合っている', () => {
  let depth = 0
  for (const ch of css) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    assert.ok(depth >= 0, '閉じ括弧が多い')
  }
  assert.equal(depth, 0, '閉じていない規則がある')
})

test('マージの目印が残っていない', () => {
  assert.equal(/^(<<<<<<<|=======|>>>>>>>)/m.test(css), false)
})
