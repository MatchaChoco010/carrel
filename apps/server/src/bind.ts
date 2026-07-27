import { networkInterfaces } from 'node:os'

// サーバーがバインドするアドレスを決める(0001「常駐とネットワーク」)。
//
// バインドするのはループバックと tailscale のインターフェースだけに限る。
// 物理 LAN には口を開けない。サーバーは論文コレクション全体を読めるうえ
// Codex のエージェントを動かせるため、到達できる範囲を tailnet の内側に閉じる。

/** tailscale が使う CGNAT 空間 100.64.0.0/10。 */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [first, second] = octets as [number, number, number, number]
  return first === 100 && second >= 64 && second <= 127
}

export type BindTarget = {
  address: string
  /** なぜこのアドレスにバインドするか。起動ログに出す。 */
  reason: 'loopback' | 'tailscale'
}

/**
 * バインド対象を列挙する。
 *
 * tailscale のアドレスは、インターフェース名と CGNAT 空間の両方で判定する。
 * 名前だけに頼ると環境によって取りこぼし、アドレス空間だけに頼ると
 * tailscale 以外が同じ空間を使っていた場合に拾ってしまうため、どちらかが
 * 当たったものを対象とする。
 */
export function resolveBindTargets(
  interfaces: NodeJS.Dict<Array<{ address: string; family: string; internal: boolean }>> = networkInterfaces(),
): BindTarget[] {
  const targets: BindTarget[] = [{ address: '127.0.0.1', reason: 'loopback' }]

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue
    const looksLikeTailscaleInterface = name.startsWith('tailscale') || name === 'ts0'
    for (const entry of addresses) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!looksLikeTailscaleInterface && !isTailscaleAddress(entry.address)) continue
      if (targets.some((t) => t.address === entry.address)) continue
      targets.push({ address: entry.address, reason: 'tailscale' })
    }
  }

  return targets
}
