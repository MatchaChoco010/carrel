import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wrapperScript } from './wrapper.ts'

test('Wayland と Vulkan の指定を必ず渡す', () => {
  const script = wrapperScript('carrel-bin')

  assert.match(script, /--ozone-platform=wayland/)
  assert.match(script, /--disable-features=Vulkan/)
})

test('渡された引数をそのまま引き継ぐ', () => {
  assert.match(wrapperScript('carrel-bin'), /"\$@"$/m)
})

test('自分の置き場所から実行ファイルを引く', () => {
  const script = wrapperScript('carrel-bin')

  assert.match(script, /dirname -- "\$0"/)
  assert.match(script, /exec "\$directory\/carrel-bin"/)
})

test('シェルの指定で始まる', () => {
  assert.ok(wrapperScript('carrel-bin').startsWith('#!/bin/sh\n'))
})
