import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatInstructions } from './instructions.ts'

test('ユーザーの指示は pct の指示の後ろに置く', () => {
  const built = chatInstructions('常体で答える。')

  assert.ok(built.startsWith('あなたは pct'), 'pct の指示が先に来る')
  assert.ok(built.endsWith('常体で答える。'), 'ユーザーの指示が後に来る')
})

test('ユーザーの指示が空なら pct の指示だけを渡す', () => {
  assert.equal(chatInstructions(''), chatInstructions('   '))
  assert.ok(!chatInstructions('').endsWith('\n\n'))
})

test('図の指し方を渡す', () => {
  const built = chatInstructions('')

  assert.match(built, /@<slug>\/assets\/<画像のファイル名>/)
  assert.match(built, /!\[説明\]\(assets\/<画像のファイル名>\)/)
})
