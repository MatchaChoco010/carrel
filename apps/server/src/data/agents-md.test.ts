import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { writeAgentsMd } from './agents-md.ts'

test('取り込みは明示的に言われたときだけだと書いてある(#296)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pct-agents-'))
  try {
    await writeAgentsMd(root)
    const body = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    assert.match(body, /取り込むよう明示的に言われたときだけ呼ぶ/)
    assert.match(body, /探すよう言われただけなら/)
    // まとめて取り込む指示は受けられる。禁じているのではない。
    assert.match(body, /まとめて取り込むよう言われることはある/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
