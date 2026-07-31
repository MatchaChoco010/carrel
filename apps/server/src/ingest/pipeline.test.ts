import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTitle } from './pipeline.ts'

test('題の突き合わせは大文字と小文字と記号の違いを均す', () => {
  assert.equal(
    normalizeTitle('Integrating Clipped Spherical Harmonics Expansions'),
    normalizeTitle('integrating clipped spherical-harmonics expansions'),
  )
  assert.equal(normalizeTitle('  NeRF: Representing Scenes  '), normalizeTitle('NeRF — Representing Scenes'))
  assert.equal(normalizeTitle('Don’t Repeat Yourself'), normalizeTitle("Don't repeat yourself"))
})

test('別の題は同じにならない', () => {
  assert.notEqual(normalizeTitle('Spherical Lighting'), normalizeTitle('Spherical Sampling'))
})

test('記号だけの題は突き合わせに使わない', () => {
  assert.equal(normalizeTitle('---'), '')
})
