import assert from 'node:assert/strict'
import test from 'node:test'
import { pdfLinksIn } from './links.ts'

const PAGE = 'https://example.github.io/multiple-bounce-BRDF/'

test('相対のリンクを、そのページを基準に解く', () => {
  const html = '<a href="static/pdfs/paper.pdf">Paper</a>'
  assert.deepEqual(pdfLinksIn(html, PAGE), ['https://example.github.io/multiple-bounce-BRDF/static/pdfs/paper.pdf'])
})

test('絶対のリンクもそのまま拾う', () => {
  const html = `<a href='https://example.org/a.pdf'>PDF</a>`
  assert.deepEqual(pdfLinksIn(html, PAGE), ['https://example.org/a.pdf'])
})

test('問い合わせの文字列が付いていても拾う', () => {
  const html = '<a href="/files/paper.pdf?download=true">PDF</a>'
  assert.deepEqual(pdfLinksIn(html, PAGE), ['https://example.github.io/files/paper.pdf?download=true'])
})

test('PDF でないリンクは拾わない', () => {
  const html = '<a href="index.html">Home</a><a href="code.zip">Code</a>'
  assert.deepEqual(pdfLinksIn(html, PAGE), [])
})

test('同じ場所は 1 つにまとめる', () => {
  const html = '<a href="p.pdf">A</a><a href="p.pdf">B</a>'
  assert.equal(pdfLinksIn(html, PAGE).length, 1)
})

test('拾う数に上限がある', () => {
  const html = Array.from({ length: 12 }, (_, i) => `<a href="p${i}.pdf">x</a>`).join('')
  assert.equal(pdfLinksIn(html, PAGE).length, 5)
})
