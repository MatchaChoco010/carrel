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

/**
 * 読みやすさの設定は CSS 変数で配る。読む場所が変数を見ていないと、設定を動かしても
 * そこだけ変わらない(#291)。
 */
test('読む場所はすべて読みやすさの変数を見ている', () => {
  const readers = ['.paper-body .markdown', '.reference__text', '.turn .markdown', '.suggest textarea']
  for (const selector of readers) {
    const rule = ruleFor(selector)
    assert.ok(rule !== null, `${selector} の規則が無い`)
    assert.match(rule, /font-size:\s*var\(--reading-font-size/, `${selector} の文字の大きさが固定`)
    assert.match(rule, /line-height:\s*var\(--reading-line-height/, `${selector} の行の高さが固定`)
  }
})

/** 指定子に続く宣言の並びを取り出す。入れ子の無い平らな CSS なので、これで足りる。 */
function ruleFor(selector: string): string | null {
  const at = css.indexOf(`\n${selector} {`)
  if (at < 0) return null
  const end = css.indexOf('}', at)
  return end < 0 ? null : css.slice(at, end)
}
