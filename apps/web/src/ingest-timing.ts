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
/** 段階が取りうる状態。記録が無い段階は、まだそこまで来ていない(0026)。 */
export type StageState = 'queued' | 'running' | 'done'

/**
 * 段階の状態を、記録の 3 つの時刻だけから決める(0026)。
 *
 * 取り込みの記録が持つ「いまどの段階か」と突き合わせないので、両者が食い違っても
 * 表示は壊れない。
 */
export function stageState(stage: { startedAt: number | null; finishedAt: number | null }): StageState {
  if (stage.finishedAt !== null) return 'done'
  return stage.startedAt === null ? 'queued' : 'running'
}

export function stageElapsed(stage: { startedAt: number | null; finishedAt: number | null }, clock: number): number {
  // 走り出していない段階に所要時間は無い。待っていた時間は所要時間に含めない(0026)。
  if (stage.startedAt === null) return 0
  return Math.max(0, (stage.finishedAt ?? clock) - stage.startedAt)
}

/** 取り込み全体にかかった時間。段階ごとの合計で出す。 */
export function totalElapsed(ingest: Pick<Ingest, 'status' | 'updatedAt' | 'stages'>, now: number): number {
  const clock = clockFor(ingest, now)
  return ingest.stages.reduce((sum, stage) => sum + stageElapsed(stage, clock), 0)
}
