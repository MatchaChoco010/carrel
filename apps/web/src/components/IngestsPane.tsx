import { Check, CircleDashed, Loader2, X } from 'lucide-react'
import type { Ingest, IngestStage } from '../api.ts'

export type IngestsPaneProps = {
  ingests: Ingest[]
}

const ICON = 14

/** 取り込みの段階。0004 が定めた順に並べる。 */
const STAGES: IngestStage[] = ['resolve', 'fetch', 'convert', 'verify', 'translate', 'register']

const STAGE_LABEL: Record<IngestStage, string> = {
  resolve: '解決',
  fetch: '取得',
  convert: '変換',
  verify: '照合',
  translate: '翻訳',
  register: '登録',
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

export function IngestsPane({ ingests }: IngestsPaneProps) {
  if (ingests.length === 0) return <p className="empty">取り込み中の論文はありません</p>

  return (
    <div className="ingests">
      {ingests.map((ingest) => {
        const byStage = new Map(ingest.stages.map((s) => [s.stage, s]))
        const at = STAGES.indexOf(ingest.stage)
        const total = ingest.stages.reduce(
          (sum, s) => sum + ((s.finishedAt ?? Date.now()) - s.startedAt),
          0,
        )

        return (
          <article key={ingest.slug} className={`ingest ingest--${ingest.status}`}>
            <header>
              <code>{ingest.slug}</code>
              <span className="ingest__total">{duration(total)}</span>
            </header>

            <ol className="ingest__stages">
              {STAGES.map((stage, index) => {
                const record = byStage.get(stage)
                const done = record !== undefined && record.finishedAt !== null
                const running = ingest.status === 'inProgress' && index === at
                const failed = ingest.status === 'failed' && index === at
                const elapsed =
                  record === undefined ? null : (record.finishedAt ?? Date.now()) - record.startedAt

                return (
                  <li
                    key={stage}
                    className={`ingest__stage ${done ? 'done' : ''} ${running ? 'running' : ''} ${failed ? 'failed' : ''}`}
                  >
                    <span className="ingest__mark">
                      {failed ? (
                        <X size={ICON} aria-hidden />
                      ) : running ? (
                        <Loader2 size={ICON} className="spin" aria-hidden />
                      ) : done ? (
                        <Check size={ICON} aria-hidden />
                      ) : (
                        <CircleDashed size={ICON} aria-hidden />
                      )}
                    </span>
                    <span className="ingest__label">{STAGE_LABEL[stage]}</span>
                    <span className="ingest__time">{elapsed === null ? '' : duration(elapsed)}</span>
                  </li>
                )
              })}
            </ol>

            {ingest.lastError === null ? null : <p className="error">{ingest.lastError}</p>}
          </article>
        )
      })}
    </div>
  )
}
