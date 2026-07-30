import type { RateLimitWindow } from './protocol.ts'

export type RateLimitSnapshot = {
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  planType: string | null
  rateLimitReachedType: string | null
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null
}

export type RateLimitWindowView = {
  usedPercent: number
  /** 回復時刻(エポック秒)。分からなければ null。 */
  resetsAt: number | null
  windowDurationMins: number | null
  /** 画面に出す制限の呼び名。 */
  label: string
}

export type RateLimitView = {
  windows: RateLimitWindowView[]
  planType: string | null
  reached: boolean
  reachedType: string | null
  /** 次に制限が解除される時刻。待機の解除に使う。 */
  nextResetAt: number | null
}

/**
 * 制限の呼び名を `windowDurationMins` から導く。
 *
 * primary を 5 時間の制限と決め打ちにすると、primary が週次を指すアカウントで
 * 誤った呼び名になる(実測で確認)。長さは値として届くので、それを使う。
 */
export function describeWindow(windowDurationMins: number | null): string {
  if (windowDurationMins === null) return '利用制限'
  if (windowDurationMins % (60 * 24 * 7) === 0) {
    const weeks = windowDurationMins / (60 * 24 * 7)
    return weeks === 1 ? '週次制限' : `${weeks} 週間の制限`
  }
  if (windowDurationMins % (60 * 24) === 0) {
    const days = windowDurationMins / (60 * 24)
    return days === 1 ? '日次制限' : `${days} 日間の制限`
  }
  if (windowDurationMins % 60 === 0) return `${windowDurationMins / 60} 時間の制限`
  return `${windowDurationMins} 分の制限`
}

function toView(window: RateLimitWindow | null): RateLimitWindowView | null {
  if (window === null) return null
  return {
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
    label: describeWindow(window.windowDurationMins),
  }
}

export function toRateLimitView(snapshot: RateLimitSnapshot): RateLimitView {
  const windows = [toView(snapshot.primary), toView(snapshot.secondary)].filter(
    (w): w is RateLimitWindowView => w !== null,
  )
  const resets = windows.map((w) => w.resetsAt).filter((v): v is number => v !== null)
  return {
    windows,
    planType: snapshot.planType,
    reached: snapshot.rateLimitReachedType !== null,
    reachedType: snapshot.rateLimitReachedType,
    nextResetAt: resets.length > 0 ? Math.min(...resets) : null,
  }
}

function asWindow(value: unknown): RateLimitWindow | null {
  if (typeof value !== 'object' || value === null) return null
  const w = value as Record<string, unknown>
  if (typeof w['usedPercent'] !== 'number') return null
  return {
    usedPercent: w['usedPercent'],
    resetsAt: typeof w['resetsAt'] === 'number' ? w['resetsAt'] : null,
    windowDurationMins: typeof w['windowDurationMins'] === 'number' ? w['windowDurationMins'] : null,
  }
}

/** 応答と通知のどちらからも同じ形を取り出す。 */
export function parseRateLimitSnapshot(value: unknown): RateLimitSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const root = value as Record<string, unknown>
  const raw = (root['rateLimits'] ?? root) as Record<string, unknown>
  if (typeof raw !== 'object' || raw === null) return null

  const credits = raw['credits']
  return {
    primary: asWindow(raw['primary']),
    secondary: asWindow(raw['secondary']),
    planType: typeof raw['planType'] === 'string' ? raw['planType'] : null,
    rateLimitReachedType: typeof raw['rateLimitReachedType'] === 'string' ? raw['rateLimitReachedType'] : null,
    credits:
      typeof credits === 'object' && credits !== null
        ? {
            hasCredits: (credits as Record<string, unknown>)['hasCredits'] === true,
            unlimited: (credits as Record<string, unknown>)['unlimited'] === true,
            balance:
              typeof (credits as Record<string, unknown>)['balance'] === 'string'
                ? ((credits as Record<string, unknown>)['balance'] as string)
                : null,
          }
        : null,
  }
}

/**
 * 通知は届いた値だけを持つ差分なので、直前の値へ重ねる。
 *
 * 値が来ていない項目を null で上書きすると、一度得た情報を捨てることになる。
 */
export function mergeSnapshot(previous: RateLimitSnapshot | null, incoming: RateLimitSnapshot): RateLimitSnapshot {
  if (previous === null) return incoming
  return {
    primary: incoming.primary ?? previous.primary,
    secondary: incoming.secondary ?? previous.secondary,
    planType: incoming.planType ?? previous.planType,
    rateLimitReachedType: incoming.rateLimitReachedType,
    credits: incoming.credits ?? previous.credits,
  }
}
