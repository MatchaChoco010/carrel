import type { Ingest } from './api.ts'

/**
 * 段階の経過時間を出すための、いまの時刻(#280)。
 *
 * 終わった取り込みでは、記録に残った最後の時刻で止める。段階が開いたまま残っていても
 * 時計が動かないようにするためである。段階を飛ばした取り込みや、サーバーが落ちた間に
 * 終わりを書けなかった記録では、開いたままの段階が残りうる。
 */
export function clockFor(ingest: Pick<Ingest, 'status' | 'updatedAt'>, now: number): number {
  return ingest.status === 'inProgress' ? now : ingest.updatedAt
}

/** 1 つの段階にかかった時間。始まりより前の時刻を渡されても負にしない。 */
export function stageElapsed(stage: { startedAt: number; finishedAt: number | null }, clock: number): number {
  return Math.max(0, (stage.finishedAt ?? clock) - stage.startedAt)
}

/** 取り込み全体にかかった時間。段階ごとの合計で出す。 */
export function totalElapsed(ingest: Pick<Ingest, 'status' | 'updatedAt' | 'stages'>, now: number): number {
  const clock = clockFor(ingest, now)
  return ingest.stages.reduce((sum, stage) => sum + stageElapsed(stage, clock), 0)
}
