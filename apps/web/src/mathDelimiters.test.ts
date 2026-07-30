import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeMathDelimiters } from './mathDelimiters.ts'

test('別行立ての区切りを $$ にする', () => {
  assert.equal(normalizeMathDelimiters('前\n\\[ a = b \\]\n後'), '前\n$$ a = b $$\n後')
})

test('文中の区切りを $ にする', () => {
  assert.equal(normalizeMathDelimiters('式は \\( x^2 \\) である'), '式は $ x^2 $ である')
})

test('複数行にまたがる数式も変える', () => {
  assert.equal(normalizeMathDelimiters('\\[\na = b\n\\]'), '$$\na = b\n$$')
})

test('すでに $ で囲まれた数式は変えない', () => {
  const text = '$$\na = b\n$$'
  assert.equal(normalizeMathDelimiters(text), text)
})

test('コードのかたまりの中は変えない', () => {
  const text = '```\nconst a = \\[1, 2\\]\n```'
  assert.equal(normalizeMathDelimiters(text), text)
})

test('コードのかたまりの外だけを変える', () => {
  const result = normalizeMathDelimiters('\\[ a \\]\n```\n\\[ b \\]\n```\n\\( c \\)')

  assert.match(result, /\$\$ a \$\$/)
  assert.match(result, /\\\[ b \\\]/)
  assert.match(result, /\$ c \$/)
})
