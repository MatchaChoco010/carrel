import { Check, CircleDashed, Eraser, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Ingest, type IngestStage } from '../api.ts'

export type IngestsPaneProps = {
  ingests: Ingest[]
  /** 記録を消した後に一覧を読み直す。 */
  onChanged: () => void
}

const ICON = 14

/** 取り込みが進む順。 */
const STAGES: IngestStage[] = [
  'resolve',
  'fetch',
  'convert',
  'verify',
  'bibliography',
  'translate',
  'references',
  'register',
]

const STAGE_LABEL: Record<IngestStage, string> = {
  resolve: '解決',
  fetch: '取得',
  convert: '変換',
  verify: '照合',
  bibliography: '書誌',
  translate: '翻訳',
  references: '参考文献',
  register: '登録',
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

export function IngestsPane({ ingests, onChanged }: IngestsPaneProps) {
  const now = useNow(ingests.some((i) => i.status === 'inProgress'))
  const [busy, setBusy] = useState(false)
  const done = ingests.filter((i) => i.status === 'done').length

  const clear = (): void => {
    setBusy(true)
    void api
      .clearIngests()
      .then(onChanged)
      .finally(() => setBusy(false))
  }

  const discard = (slug: string): void => {
    setBusy(true)
    void api
      .discardIngest(slug)
      .then(onChanged)
      .finally(() => setBusy(false))
  }

  if (ingests.length === 0) return <p className="empty">取り込み中の論文はありません</p>

  return (
    <div className="ingests">
      {done > 0 && (
        <div className="ingests__actions">
          <button type="button" onClick={clear} disabled={busy}>
            {busy ? <Loader2 size={ICON} className="spin" aria-hidden /> : <Eraser size={ICON} aria-hidden />}
            完了した {done} 件の記録を消す
          </button>
        </div>
      )}
      {ingests.map((ingest) => {
        const byStage = new Map(ingest.stages.map((s) => [s.stage, s]))
        const at = STAGES.indexOf(ingest.stage)
        const total = ingest.stages.reduce((sum, s) => sum + ((s.finishedAt ?? now) - s.startedAt), 0)

        return (
          <article key={ingest.slug} className={`ingest ingest--${ingest.status}`}>
            <header>
              <code>{ingest.slug}</code>
              <span className="ingest__total">{duration(total)}</span>
              {/* 失敗した取り込みは、捨てると半端な成果物も消える(#223)。 */}
              {ingest.status === 'failed' && (
                <button
                  type="button"
                  className="ingest__discard"
                  onClick={() => discard(ingest.slug)}
                  disabled={busy}
                  title="この取り込みを捨てる"
                  aria-label={`${ingest.slug} の取り込みを捨てる`}
                >
                  <Trash2 size={ICON} aria-hidden />
                </button>
              )}
            </header>

            <ol className="ingest__stages">
              {STAGES.map((stage, index) => {
                const record = byStage.get(stage)
                const done = record !== undefined && record.finishedAt !== null
                const running = ingest.status === 'inProgress' && index === at
                const failed = ingest.status === 'failed' && index === at
                const elapsed =
                  record === undefined ? null : (record.finishedAt ?? now) - record.startedAt

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
