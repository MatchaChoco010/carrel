declare const isoDateTimeBrand: unique symbol

/**
 * オフセット付きの ISO 8601 日時。
 *
 * `Date` にせず文字列のまま保つのは、ファイルに書かれたオフセットを維持する
 * ためである。`Date` へ通すと現地時刻が UTC へ書き換わり、ユーザーが読み書き
 * する markdown の値が保存のたびに変わってしまう。
 */
export type IsoDateTime = string & { readonly [isoDateTimeBrand]: true }

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function isIsoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === 'string' && ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value))
}

/** 形が合わない値は受け取らない。手で編集されたファイルから読むため。 */
export function parseIsoDateTime(value: unknown): IsoDateTime | null {
  return isIsoDateTime(value) ? value : null
}

function offsetOf(date: Date): string {
  const minutes = -date.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** 現地時刻のオフセットを保った文字列にする。 */
export function toIsoDateTime(date: Date): IsoDateTime {
  const y = String(date.getFullYear()).padStart(4, '0')
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offsetOf(date)}` as IsoDateTime
}

export function nowIsoDateTime(): IsoDateTime {
  return toIsoDateTime(new Date())
}

/** 比較や並べ替えのために数値へ落とす。 */
export function toEpochMs(value: IsoDateTime): number {
  return Date.parse(value)
}

export const EPOCH_ISO_DATE_TIME: IsoDateTime = toIsoDateTime(new Date(0))
