import type { ConnectionState } from '../useServerEvents.ts'
import type { CodexStatus } from '../api.ts'

function remaining(resetsAt: number | null): string {
  if (resetsAt === null) return '回復時刻は不明'
  const minutes = Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60_000))
  if (minutes < 60) return `回復まで ${minutes} 分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `回復まで ${hours} 時間 ${minutes % 60} 分`
  return `回復まで ${Math.floor(hours / 24)} 日 ${hours % 24} 時間`
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: '接続中',
  open: '接続',
  closed: '切断',
}

export function StatusLine({
  codex,
  connection,
  runningJobs,
}: {
  codex: CodexStatus | null
  connection: ConnectionState
  runningJobs: number
}) {
  const limits = codex?.rateLimits ?? null

  return (
    <footer className="status-line">
      <span className={`status-dot status-dot--${connection}`} title={CONNECTION_LABEL[connection]} />
      <span className="status-item">{CONNECTION_LABEL[connection]}</span>

      {limits === null ? (
        <span className="status-item status-item--muted">残枠を取得していない</span>
      ) : (
        limits.windows.map((window) => (
          <span
            key={window.label}
            className={`status-item ${window.usedPercent >= 90 ? 'status-item--warn' : ''}`}
            title={remaining(window.resetsAt)}
          >
            {window.label} {window.usedPercent}%
            <span className="status-meter" aria-hidden>
              <span className="status-meter__fill" style={{ width: `${Math.min(100, window.usedPercent)}%` }} />
            </span>
          </span>
        ))
      )}

      {limits?.reached === true && <span className="status-item status-item--warn">枠の回復待ち</span>}
      {limits?.planType !== null && limits !== null && (
        <span className="status-item status-item--muted">{limits.planType}</span>
      )}
      {runningJobs > 0 && <span className="status-item">実行中のジョブ {runningJobs}</span>}
    </footer>
  )
}
