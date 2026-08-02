import assert from 'node:assert/strict'
import test from 'node:test'
import { doiPointsAtPaper, parseDoiRecord, type DoiLookup, type DoiRecord } from './verify-doi.ts'

const RECORD: DoiRecord = {
  title: 'Progressive Photorealistic Simplification',
  authors: ['Ana Rosenthal'],
  year: 2026,
  container: 'ACM SIGGRAPH 2026 Conference Papers',
}

const found: DoiLookup = async () => RECORD
const missing: DoiLookup = async () => null
const yes = async (): Promise<boolean> => true
const no = async (): Promise<boolean> => false

test('この論文のものだと答えられた DOI は受け取る(#287)', async () => {
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811083', found, yes), true)
})

test('別の文献だと答えられた DOI は受け取らない(#287)', async () => {
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811050', found, no), false)
})

test('どこも指さない DOI は判断を仰がずに捨てる(#287)', async () => {
  // 桁を落とした DOI が実際に入っていた。
  let asked = false
  const judge = async (): Promise<boolean> => {
    asked = true
    return true
  }
  assert.equal(await doiPointsAtPaper('10.1145/3799902.381122', missing, judge), false)
  assert.equal(asked, false)
})

test('引けなかったときは受け取らない(#287)', async () => {
  const broken: DoiLookup = async () => {
    throw new Error('通信に失敗した')
  }
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811083', broken, yes), false)
})

test('判断そのものが失敗したときも受け取らない(#287)', async () => {
  const broken = async (): Promise<boolean> => {
    throw new Error('スレッドが落ちた')
  }
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811083', found, broken), false)
})

test('CSL JSON から判断に使う項目を取り出す(#287)', () => {
  const record = parseDoiRecord({
    title: ['PQ-Free HD: Priority-Queue-Free Hausdorff Distance'],
    author: [
      { given: 'Vincent', family: 'Schüßler' },
      { literal: 'The Khronos Group' },
      { family: 'Heitz' },
    ],
    issued: { 'date-parts': [[2026, 8, 2]] },
    'container-title': ['ACM Transactions on Graphics'],
  })
  assert.deepEqual(record, {
    title: 'PQ-Free HD: Priority-Queue-Free Hausdorff Distance',
    authors: ['Vincent Schüßler', 'The Khronos Group', 'Heitz'],
    year: 2026,
    container: 'ACM Transactions on Graphics',
  })
})

test('題の無い応答は登録内容として扱わない(#287)', () => {
  assert.equal(parseDoiRecord({ author: [] }), null)
  assert.equal(parseDoiRecord(null), null)
})
