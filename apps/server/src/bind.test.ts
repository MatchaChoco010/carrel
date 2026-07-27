import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTailscaleAddress, resolveBindTargets } from './bind.ts'

test('CGNAT 空間 100.64.0.0/10 だけを tailscale のアドレスとみなす', () => {
  assert.equal(isTailscaleAddress('100.64.0.1'), true)
  assert.equal(isTailscaleAddress('100.76.110.26'), true)
  assert.equal(isTailscaleAddress('100.127.255.255'), true)
  assert.equal(isTailscaleAddress('100.63.255.255'), false)
  assert.equal(isTailscaleAddress('100.128.0.0'), false)
  assert.equal(isTailscaleAddress('192.168.1.10'), false)
  assert.equal(isTailscaleAddress('not-an-address'), false)
})

test('物理 LAN のアドレスにはバインドしない', () => {
  const targets = resolveBindTargets({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    enp5s0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
    tailscale0: [{ address: '100.76.110.26', family: 'IPv4', internal: false }],
  })

  assert.deepEqual(targets, [
    { address: '127.0.0.1', reason: 'loopback' },
    { address: '100.76.110.26', reason: 'tailscale' },
  ])
})

test('インターフェース名が tailscale でなくても CGNAT 空間なら拾う', () => {
  const targets = resolveBindTargets({
    ts99: [{ address: '100.100.1.1', family: 'IPv4', internal: false }],
  })
  assert.deepEqual(targets.map((t) => t.address), ['127.0.0.1', '100.100.1.1'])
})

test('tailscale が無ければループバックだけになる', () => {
  const targets = resolveBindTargets({
    enp5s0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
  })
  assert.deepEqual(targets, [{ address: '127.0.0.1', reason: 'loopback' }])
})

test('IPv6 は対象にしない', () => {
  const targets = resolveBindTargets({
    tailscale0: [{ address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false }],
  })
  assert.deepEqual(targets, [{ address: '127.0.0.1', reason: 'loopback' }])
})
