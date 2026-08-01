import assert from 'node:assert/strict'
import test from 'node:test'
import { doiPointsAtPaper, type DoiLookup } from './verify-doi.ts'

const TITLE = 'Progressive Photorealistic Simplification'

/** 引く先の代役。DOI ごとに返す題を決める。 */
function lookup(table: Record<string, string>): DoiLookup {
  return async (doi) => (doi in table ? { title: table[doi] as string } : null)
}

test('その論文を指す DOI は受け取る(#287)', async () => {
  const found = lookup({ '10.1145/3799902.3811083': 'Progressive Photorealistic Simplification' })
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811083', TITLE, found), true)
})

test('別の文献を指す DOI は受け取らない(#287)', async () => {
  // 実際に入っていた誤り。同じ予稿集の中の別の論文である。
  const found = lookup({
    '10.1145/3799902.3811050': 'Gradient Descent in the ALPS: Abstracted Low-Poly Stylization and Fabrication',
  })
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811050', TITLE, found), false)
})

test('どこも指さない DOI は受け取らない(#287)', async () => {
  // 桁を落とした DOI が実際に入っていた。
  assert.equal(await doiPointsAtPaper('10.1145/3799902.381122', TITLE, lookup({})), false)
})

test('引けなかったときは受け取らない(#287)', async () => {
  const broken: DoiLookup = async () => {
    throw new Error('通信に失敗した')
  }
  assert.equal(await doiPointsAtPaper('10.1145/3799902.3811083', TITLE, broken), false)
})

test('副題や記号の違いは同じ論文と認める(#287)', async () => {
  const asked = 'PQ-Free HD: Priority-Queue-Free Hausdorff Distance for Triangle Meshes on GPU'
  const found = lookup({ '10.1145/3811324': 'PQ-Free HD — Priority Queue Free Hausdorff Distance for Triangle Meshes on GPU' })
  assert.equal(await doiPointsAtPaper('10.1145/3811324', asked, found), true)
})

test('発音記号の違いも同じ論文と認める(#287)', async () => {
  const asked = 'Über die Bewegung von Partikeln'
  const found = lookup({ '10.1000/x': 'Uber die Bewegung von Partikeln' })
  assert.equal(await doiPointsAtPaper('10.1000/x', asked, found), true)
})
