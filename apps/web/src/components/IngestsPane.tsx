import { Check, CircleDashed, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Ingest, IngestStage } from '../api.ts'

export type IngestsPaneProps = {
  ingests: Ingest[]
}

const ICON = 13

/** 取り込みが進む順。 */
const STAGES: IngestStage[] = ['resolve', 'fetch', 'convert', 'verify', 'translate', 'register', 'references']

const STAGE_LABEL: Record<IngestStage, string> = {
  resolve: '解決',
  fetch: '取得',
  convert: '変換',
  verify: '照合',
  translate: '翻訳',
  register: '登録',
  references: '参考文献',
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

/**
 * 経過時間を毎秒進めるための刻み。
 *
 * 取り込みの記録を読み直す間隔に合わせると、経過時間が飛び飛びに増えて止まって
 * 見える。表示する時刻は記録の取得とは別に進める。
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return active ? now : Date.now()
}

export function IngestsPane({ ingests }: IngestsPaneProps) {
  const now = useNow(ingests.some((i) => i.status === 'inProgress'))
  if (ingests.length === 0) return <p className="empty">取り込み中の論文はありません</p>

  return (
    <div className="ingests">
      {ingests.map((ingest) => {
        const byStage = new Map(ingest.stages.map((s) => [s.stage, s]))
        const at = STAGES.indexOf(ingest.stage)
        const total = ingest.stages.reduce((sum, s) => sum + ((s.finishedAt ?? now) - s.startedAt), 0)

        return (
          <article key={ingest.slug} className={`ingest ingest--${ingest.status}`}>
            <div className="ingest__row">
              <code className="ingest__slug">{ingest.slug}</code>

              <ol className="ingest__stages">
                {STAGES.map((stage, index) => {
                  const record = byStage.get(stage)
                  const done = record !== undefined && record.finishedAt !== null
                  const running = ingest.status === 'inProgress' && index === at
                  const failed = ingest.status === 'failed' && index === at
                  const elapsed = record === undefined ? null : (record.finishedAt ?? now) - record.startedAt

                  return (
                    <li
                      key={stage}
                      className={`ingest__stage ${done ? 'done' : ''} ${running ? 'running' : ''} ${failed ? 'failed' : ''}`}
                      // 印だけの段階では、名前と経過時間をここから読む。
                      title={`${STAGE_LABEL[stage]}${elapsed === null ? '' : ` ${duration(elapsed)}`}`}
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
                      {/* 1 行に収めるため、名前と経過時間はいま止まっている段階にだけ出す。 */}
                      {running || failed ? (
                        <>
                          <span className="ingest__label">{STAGE_LABEL[stage]}</span>
                          {elapsed === null ? null : <span className="ingest__time">{duration(elapsed)}</span>}
                        </>
                      ) : null}
                    </li>
                  )
                })}
              </ol>

              <span className="ingest__total">{duration(total)}</span>
            </div>

            {ingest.lastError === null ? null : (
              <p className="error ingest__error" title={ingest.lastError}>
                {ingest.lastError}
              </p>
            )}
          </article>
        )
      })}
    </div>
  )
}
