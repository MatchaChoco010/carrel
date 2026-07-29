import { FileText, ListTodo, MessagesSquare, Rss, Settings, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type CodexStatus, type IndexStatus, type JobsResponse } from './api.ts'
import { JobsPane } from './components/JobsPane.tsx'
import { PapersPane } from './components/PapersPane.tsx'
import { StatusLine } from './components/StatusLine.tsx'
import { useServerEvents, type ServerEvent } from './useServerEvents.ts'

type Tab = 'feed' | 'papers' | 'chats' | 'jobs' | 'settings'

const TABS: Array<{ id: Tab; Icon: LucideIcon; label: string }> = [
  { id: 'feed', Icon: Rss, label: 'フィード' },
  { id: 'papers', Icon: FileText, label: '論文リスト' },
  { id: 'chats', Icon: MessagesSquare, label: 'チャットリスト' },
  { id: 'jobs', Icon: ListTodo, label: 'ジョブ' },
]

const SETTINGS_TAB: { id: Tab; Icon: LucideIcon; label: string } = {
  id: 'settings',
  Icon: Settings,
  label: '設定',
}

const ICON_SIZE = 18

const NARROW = '(max-width: 820px)'

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = (): void => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

export function App() {
  const [tab, setTab] = useState<Tab>('papers')
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [jobs, setJobs] = useState<JobsResponse | null>(null)
  const [index, setIndex] = useState<IndexStatus | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  // 取り込みや削除の後に一覧を読み直すための番号。
  const [revision, setRevision] = useState(0)
  const narrow = useIsNarrow()

  const reloadJobs = useCallback(() => {
    void api.jobs().then(setJobs).catch(() => setJobs(null))
  }, [])

  useEffect(() => {
    void api.codexStatus().then(setCodex).catch(() => setCodex(null))
    void api.indexStatus().then(setIndex).catch(() => setIndex(null))
    reloadJobs()
  }, [reloadJobs])

  const onEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'codex.rateLimits':
          setCodex((previous) => ({ running: previous?.running ?? true, rateLimits: event.payload as never }))
          return
        case 'job.changed':
          reloadJobs()
          return
        case 'paper.changed':
        case 'paper.removed':
        case 'chat.changed':
        case 'chat.removed':
        case 'index.rebuilt':
          void api.indexStatus().then(setIndex).catch(() => {})
          return
        default:
          return
      }
    },
    [reloadJobs],
  )

  const connection = useServerEvents(onEvent)
  const running = jobs?.counts.running ?? 0

  return (
    <div className={`app ${narrow ? 'app--narrow' : ''}`}>
      <nav className="rail" aria-label="画面の切り替え">
        <div className="rail__group">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`rail__button ${tab === entry.id ? 'rail__button--active' : ''}`}
              onClick={() => setTab(entry.id)}
              title={entry.label}
              aria-label={entry.label}
              aria-current={tab === entry.id}
            >
              <entry.Icon size={ICON_SIZE} aria-hidden />
              {entry.id === 'jobs' && running > 0 && <span className="rail__badge">{running}</span>}
            </button>
          ))}
        </div>
        <div className="rail__group rail__group--end">
          <button
            type="button"
            className={`rail__button ${tab === SETTINGS_TAB.id ? 'rail__button--active' : ''}`}
            onClick={() => setTab(SETTINGS_TAB.id)}
            title={SETTINGS_TAB.label}
            aria-label={SETTINGS_TAB.label}
          >
            <SETTINGS_TAB.Icon size={ICON_SIZE} aria-hidden />
          </button>
        </div>
      </nav>

      <main className={`panes ${narrow && chatOpen ? 'panes--chat' : ''}`}>
        <section className="pane pane--list" aria-label="一覧">
          <header className="pane__header">
            <h2 className="pane__title">{[...TABS, SETTINGS_TAB].find((t) => t.id === tab)?.label}</h2>
            {narrow && (
              <button type="button" className="pane__chat-toggle" onClick={() => setChatOpen(true)}>
                チャットを開く
              </button>
            )}
          </header>
          <div className="pane__body">
            {tab === 'jobs' ? (
              <JobsPane jobs={jobs} />
            ) : tab === 'papers' ? (
              <PapersPane
                tags={index?.tags ?? []}
                revision={revision}
                onChanged={() => setRevision((n) => n + 1)}
              />
            ) : tab === 'chats' ? (
              <p className="pane__empty">記録されたチャット {index?.chats ?? 0} 件。一覧の表示は後続の作業で足す。</p>
            ) : tab === 'feed' ? (
              <p className="pane__empty">フィードの取得は後続の作業で足す。</p>
            ) : (
              <p className="pane__empty">設定の編集は後続の作業で足す。</p>
            )}
          </div>
        </section>

        <section className="pane pane--chat" aria-label="チャット">
          <header className="pane__header">
            <h2 className="pane__title">チャット</h2>
            {narrow && (
              <button type="button" className="pane__chat-toggle" onClick={() => setChatOpen(false)}>
                閉じる
              </button>
            )}
          </header>
          <div className="pane__body">
            <p className="pane__empty">チャットは後続の作業で足す。</p>
          </div>
        </section>
      </main>

      <StatusLine codex={codex} connection={connection} runningJobs={running} />
    </div>
  )
}
