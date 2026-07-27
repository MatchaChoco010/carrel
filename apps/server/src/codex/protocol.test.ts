import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isAgentMessageItem, isApprovalRequest, METHODS, NOTIFICATIONS } from './protocol.ts'

test('承認を求めるサーバ要求を見分ける', () => {
  assert.equal(isApprovalRequest('item/commandExecution/requestApproval'), true)
  assert.equal(isApprovalRequest('item/fileChange/requestApproval'), true)
  assert.equal(isApprovalRequest('item/permissions/requestApproval'), true)
  assert.equal(isApprovalRequest('execCommandApproval'), true)
  assert.equal(isApprovalRequest('applyPatchApproval'), true)
  assert.equal(isApprovalRequest('turn/started'), false)
  assert.equal(isApprovalRequest('item/completed'), false)
})

test('最終的な応答が載る item を見分ける', () => {
  assert.equal(isAgentMessageItem({ type: 'agentMessage', id: 'm1', text: 'x', phase: 'final_answer' }), true)
  assert.equal(isAgentMessageItem({ type: 'commandExecution', id: 'c1' }), false)
  assert.equal(isAgentMessageItem(null), false)
})

/**
 * 手で写した method 名が公式の定義と食い違っていないかを確かめる。
 *
 * codex が入っていない環境では飛ばす。プロトコルの更新で名前が変わったことを
 * 開発機で気づけるようにするのが目的で、CI の必須条件にはしない。
 */
test('method 名が app-server の定義と一致する', (t) => {
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'pct-schema-'))
    execFileSync('codex', ['app-server', 'generate-json-schema', '--out', dir], { stdio: 'ignore' })
  } catch {
    t.skip('codex app-server が使えないため飛ばす')
    return
  }

  try {
    const schema = readFileSync(join(dir, 'codex_app_server_protocol.v2.schemas.json'), 'utf8')
    const clientRequest = readFileSync(join(dir, 'ClientRequest.json'), 'utf8')
    const serverNotification = readFileSync(join(dir, 'ServerNotification.json'), 'utf8')
    const haystack = `${schema}\n${clientRequest}\n${serverNotification}`

    for (const method of Object.values(METHODS)) {
      assert.ok(haystack.includes(`"${method}"`), `method が定義に見つからない: ${method}`)
    }
    for (const notification of Object.values(NOTIFICATIONS)) {
      assert.ok(haystack.includes(`"${notification}"`), `通知が定義に見つからない: ${notification}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
