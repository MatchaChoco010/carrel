/**
 * 文字列をクリップボードへ書く。
 *
 * tailscale の IP へ平文の HTTP で繋ぐと安全なオリジンとして扱われず、
 * `navigator.clipboard` が使えない。その環境でも slug をコピーできるように、
 * 選択して複製する古い手順へ落とす。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard !== undefined && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 権限が下りない場合があるので、下の手順へ落ちる。
    }
  }

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}
