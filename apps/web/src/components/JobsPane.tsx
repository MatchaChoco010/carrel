import type { Job, JobsResponse, JobState } from '../api.ts'

const STATE_LABEL: Record<JobState, string> = {
  pending: '待機中',
  running: '実行中',
  waitingForQuota: '制限の解除待ち',
  failed: '失敗',
  done: '完了',
}

const ORDER: JobState[] = ['running', 'waitingForQuota', 'pending', 'failed', 'done']

export function JobsPane({ jobs }: { jobs: JobsResponse | null }) {
  if (jobs === null) return <p className="pane__empty">読み込み中</p>
  if (jobs.jobs.length === 0) return <p className="pane__empty">実行中の処理はありません</p>

  const byState = new Map<JobState, Job[]>()
  for (const job of jobs.jobs) {
    const list = byState.get(job.state) ?? []
    list.push(job)
    byState.set(job.state, list)
  }

  return (
    <div className="jobs">
      {ORDER.filter((state) => (byState.get(state)?.length ?? 0) > 0).map((state) => (
        <section key={state} className="jobs__group">
          <h3 className="jobs__heading">
            {STATE_LABEL[state]}
            <span className="jobs__count">{byState.get(state)?.length}</span>
          </h3>
          <ul className="jobs__list">
            {byState.get(state)?.map((job) => (
              <li key={job.id} className={`jobs__item jobs__item--${job.state}`}>
                <span className="jobs__kind">{job.kind}</span>
                <span className="jobs__target">{job.target}</span>
                <span className="jobs__meta">
                  {job.resource}
                  {job.priority === 'foreground' ? ' / foreground' : ''}
                  {job.attempts > 0 ? ` / 試行 ${job.attempts}` : ''}
                </span>
                {job.lastError !== null && <span className="jobs__error">{job.lastError}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
