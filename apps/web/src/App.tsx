import { FileText, ListTodo, MessagesSquare, Rss, Settings, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type CodexStatus,
  type IndexStatus,
  type Ingest,
  type JobsResponse,
  type PaperIndexEntry,
} from './api.ts'
import { ChatPane } from './components/ChatPane.tsx'
import { ChatsPane } from './components/ChatsPane.tsx'
import { SettingsPane } from './components/SettingsPane.tsx'
import { FeedPane } from './components/FeedPane.tsx'
import { IngestsPane } from './components/IngestsPane.tsx'
import { JobsPane } from './components/JobsPane.tsx'
import { PapersPane } from './components/PapersPane.tsx'
import { StatusLine } from './components/StatusLine.tsx'
import { Toasts } from './components/Toasts.tsx'
import { useServerEvents, type ServerEvent } from './useServerEvents.ts'
import { useLang } from './useLang.ts'
import { useReading } from './useReading.ts'
import { useSplit } from './useSplit.ts'
import { useToasts } from './useToasts.ts'

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
  // 一度でも開いたタブ。開くまでは中身を作らず、開いた後は隠すだけにして状態を残す。
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set<Tab>(['papers']))
  const openTab = useCallback((id: Tab): void => {
    setTab(id)
    setOpened((previous) => (previous.has(id) ? previous : new Set(previous).add(id)))
  }, [])
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [jobs, setJobs] = useState<JobsResponse | null>(null)
  const [index, setIndex] = useState<IndexStatus | null>(null)
  const [ingests, setIngests] = useState<Ingest[]>([])
  const [unread, setUnread] = useState(0)
  // 起動時に一度引く論文の一覧。参照の短縮と `@` の補完が読む(0024)。
  const [papers, setPapers] = useState<PaperIndexEntry[]>([])
  // 右の欄で開いている会話。左の一覧から選ぶ。
  const [activeChat, setActiveChat] = useState<string | null>(null)
  // チャット欄がターンの進みを受け取るための購読先。
  const listeners = useRef(new Set<(event: ServerEvent) => void>())
  const [chatOpen, setChatOpen] = useState(false)
  // 取り込みや削除の後に一覧を読み直すための番号。
  const [revision, setRevision] = useState(0)
  /**
   * 開いている論文の履歴。末尾が今の論文で、参考文献から移るたびに伸びる(0015)。
   *
   * チャットの参照からも積むので、論文の一覧ではなくここで持つ(0024)。
   */
  const [trail, setTrail] = useState<string[]>([])
  const narrow = useIsNarrow()
  const panes = useRef<HTMLElement | null>(null)
  const split = useSplit(panes)
  const [lang, setLang] = useLang()
  // 読みやすさはこの端末に持つので、設定の欄ではなくここで受けて配る。
  const [reading, setReading] = useReading()
  const { toasts, notify, dismiss } = useToasts()

  /**
   * チャットの参照から論文の詳細を開く(0024)。
   *
   * 参考文献から移るときと同じ履歴に積むので、既に論文を開いていれば「戻る」で返れる。
   * 一覧を見ているときは履歴を新しく張る。
   */
  const openPaper = useCallback((slug: string): void => {
    openTab('papers')
    setTrail((previous) => (previous.length === 0 ? [slug] : [...previous, slug]))
    // 狭い画面ではチャットが前面に出ているので、畳んで論文を見せる。
    setChatOpen(false)
  }, [openTab])

  const reloadJobs = useCallback(() => {
    void api.jobs().then(setJobs).catch(() => setJobs(null))
    void api
      .ingests()
      .then((r) => setIngests(r.ingests))
      .catch(() => setIngests([]))
    void api
      .feed()
      .then((r) => setUnread(r.unread))
      .catch(() => setUnread(0))
    void api
      .slugs()
      .then((r) => setPapers(r.slugs))
      .catch(() => setPapers([]))
  }, [])

  const subscribe = useCallback((handler: (event: ServerEvent) => void) => {
    listeners.current.add(handler)
    return () => {
      listeners.current.delete(handler)
    }
  }, [])

  const onEvent = useCallback(
    (event: ServerEvent) => {
      for (const listener of listeners.current) listener(event)
      switch (event.type) {
        case 'codex.rateLimits':
          setCodex((previous) => ({ running: previous?.running ?? true, rateLimits: event.payload as never }))
          return
        case 'job.changed':
          reloadJobs()
          return
        case 'feed.changed':
          setUnread((event.payload as { unread: number }).unread)
          return
        case 'chat.changed':
        case 'chat.removed':
          // 会話が増えたり題が変わったら一覧を読み直す。
          setRevision((n) => n + 1)
          void api.indexStatus().then(setIndex).catch(() => {})
          return
        case 'paper.changed':
        case 'paper.removed':
        case 'index.rebuilt':
          // 取り込みが終わった論文がすぐ一覧に出るように、読み直す番号も進める(#222)。
          setRevision((n) => n + 1)
          void api.indexStatus().then(setIndex).catch(() => {})
          return
        default:
          return
      }
    },
    [reloadJobs],
  )

  const connection = useServerEvents(onEvent)

  /**
   * 繋がったときに、いまの状態をすべて読み直す(#266)。
   *
   * 画面はサーバーからの通知でしか一覧を読み直さないので、切れている間に変わったものを
   * 取りこぼす。サーバーの入れ替えや端末が眠っている間に取り込みが終わると、次の通知が
   * 来るまで古い一覧のままになる。繋ぎ直しも同じ扱いにする。
   */
  useEffect(() => {
    if (connection !== 'open') return
    void api.codexStatus().then(setCodex).catch(() => setCodex(null))
    void api.indexStatus().then(setIndex).catch(() => setIndex(null))
    reloadJobs()
    setRevision((n) => n + 1)
  }, [connection, reloadJobs])

  const running = jobs?.counts.running ?? 0

  /**
   * 取り込みの結果を知らせる(#229)。
   *
   * 取り込みは押してから数分かかり、終わりは記録の状態でしか分からない。前に見た状態と
   * 比べて、変わったものだけを出す。
   */
  const seenIngests = useRef(new Map<string, string>())
  useEffect(() => {
    const seen = seenIngests.current
    for (const ingest of ingests) {
      const before = seen.get(ingest.slug)
      seen.set(ingest.slug, ingest.status)
      // 初めて見る記録は、開き直したときに過去の分まで流れるので知らせない。
      if (before === undefined || before === ingest.status) continue
      if (ingest.status === 'done') notify(`取り込みが終わった: ${ingest.slug}`)
      if (ingest.status === 'failed') notify(`取り込みに失敗した(${ingest.stage}): ${ingest.slug}`, 'error')
    }
    for (const slug of [...seen.keys()]) {
      if (!ingests.some((ingest) => ingest.slug === slug)) seen.delete(slug)
    }
  }, [ingests, notify])

  /** 枠が尽きて待ちに入ったことを知らせる(#229、0003)。 */
  const waiting = jobs?.counts.waitingForQuota ?? 0
  const waitedBefore = useRef(0)
  useEffect(() => {
    if (waiting > 0 && waitedBefore.current === 0) {
      notify('Codex の枠が尽きたので、空くまで待っている', 'error')
    }
    waitedBefore.current = waiting
  }, [waiting, notify])

  /**
   * まだ記録になっていない取り込み(#230)。
   *
   * 解決の仕事は slug が決まる前から積まれているので、これを出せば押した直後から進みが出る。
   * 記録ができた取り込みは、記録の側に出るのでここから外す。
   */
  const waitingIngests = useMemo(() => {
    const started = new Set(ingests.map((ingest) => ingest.sourceUrl))
    return (jobs?.jobs ?? [])
      .filter((job) => job.kind === 'resolve' && (job.state === 'pending' || job.state === 'running'))
      .filter((job) => !started.has(job.target) && !ingests.some((i) => i.sourceUrl.startsWith(`${job.target}/`)))
      .map((job) => ({ id: job.id, target: job.target, createdAt: job.createdAt }))
  }, [jobs, ingests])

  return (
    <div className={`app ${narrow ? 'app--narrow' : ''}`}>
      <nav className="rail" aria-label="画面の切り替え">
        <div className="rail__group">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`rail__button ${tab === entry.id ? 'rail__button--active' : ''}`}
              onClick={() => openTab(entry.id)}
              title={entry.label}
              aria-label={entry.label}
              aria-current={tab === entry.id}
            >
              <entry.Icon size={ICON_SIZE} aria-hidden />
              {entry.id === 'jobs' && running > 0 && <span className="rail__badge">{running}</span>}
              {entry.id === 'feed' && unread > 0 && <span className="rail__badge">{unread}</span>}
            </button>
          ))}
        </div>
        <div className="rail__group rail__group--end">
          <button
            type="button"
            className={`rail__button ${tab === SETTINGS_TAB.id ? 'rail__button--active' : ''}`}
            onClick={() => openTab(SETTINGS_TAB.id)}
            title={SETTINGS_TAB.label}
            aria-label={SETTINGS_TAB.label}
          >
            <SETTINGS_TAB.Icon size={ICON_SIZE} aria-hidden />
          </button>
        </div>
      </nav>

      <main
        ref={panes}
        className={`panes ${narrow && chatOpen ? 'panes--chat' : ''} ${split.dragging ? 'panes--dragging' : ''}`}
        style={narrow ? undefined : { gridTemplateColumns: `${split.percent}% 5px 1fr` }}
      >
        <section className="pane pane--list" aria-label="一覧">
          <header className="pane__header">
            <h2 className="pane__title">{[...TABS, SETTINGS_TAB].find((t) => t.id === tab)?.label}</h2>
            {narrow && (
              <button type="button" className="pane__chat-toggle" onClick={() => setChatOpen(true)}>
                チャットを開く
              </button>
            )}
          </header>
          <div className="pane__body pane__body--tabs">
            {opened.has('jobs') && (
              <div className="pane__slot" hidden={tab !== 'jobs'}>
                <div className="jobs-tab">
                  <IngestsPane ingests={ingests} waiting={waitingIngests} onChanged={reloadJobs} />
                  <JobsPane jobs={jobs} onCleared={reloadJobs} />
                </div>
              </div>
            )}
            {opened.has('papers') && (
              <div className="pane__slot" hidden={tab !== 'papers'}>
                <PapersPane
                  lang={lang}
                  onLangChange={setLang}
                  tags={index?.tags ?? []}
                  revision={revision}
                  onChanged={() => setRevision((n) => n + 1)}
                  onNotify={notify}
                  trail={trail}
                  onTrailChange={setTrail}
                />
              </div>
            )}
            {opened.has('chats') && (
              <div className="pane__slot" hidden={tab !== 'chats'}>
                <ChatsPane
                  active={activeChat}
                  onOpen={(path) => {
                    setActiveChat(path)
                    if (narrow) setChatOpen(true)
                  }}
                  revision={revision}
                  onChanged={() => setRevision((n) => n + 1)}
                />
              </div>
            )}
            {opened.has('feed') && (
              <div className="pane__slot" hidden={tab !== 'feed'}>
                <FeedPane
                  lang={lang}
                  onLangChange={setLang}
                  visible={tab === 'feed'}
                  revision={revision}
                  onUnread={setUnread}
                  onChanged={() => setRevision((n) => n + 1)}
                />
              </div>
            )}
            {opened.has('settings') && (
              <div className="pane__slot" hidden={tab !== 'settings'}>
                <SettingsPane
                  onChanged={() => setRevision((n) => n + 1)}
                  reading={reading}
                  onReadingChange={setReading}
                />
              </div>
            )}
          </div>
        </section>

        {/* 一覧とチャットの境目。掴んで動かせる。 */}
        <div
          className="split"
          role="separator"
          aria-orientation="vertical"
          aria-label="一覧とチャットの幅"
          onMouseDown={split.onGrab}
        />

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
            <ChatPane
              id={activeChat}
              onOpen={setActiveChat}
              limits={codex?.rateLimits ?? null}
              papers={papers}
              onOpenPaper={openPaper}
              subscribe={subscribe}
              fontSize={reading.fontSize}
            />
          </div>
        </section>
      </main>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      <StatusLine codex={codex} connection={connection} runningJobs={running} />
    </div>
  )
}
