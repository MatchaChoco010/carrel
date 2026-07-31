import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatInstructions, instructionChangeNotice } from './instructions.ts'

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

test('差し込みは、入れ替わったことと応答しないことを書く', () => {
  const notice = instructionChangeNotice('常体で答える。')

  assert.match(notice, /pct からの連絡/)
  assert.match(notice, /常体で答える。/)
  assert.match(notice, /応答しない/)
  assert.ok(notice.endsWith('---\n'), '続く発言と区切る')
})

test('指示を空にしたときは、取り消されたことを書く', () => {
  const notice = instructionChangeNotice('')

  assert.match(notice, /取り消された/)
  assert.match(notice, /pct の指示だけに従う/)
})
