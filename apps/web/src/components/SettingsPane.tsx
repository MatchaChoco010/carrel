import { Check, Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type CodexModel, type Config } from '../api.ts'

export type SettingsPaneProps = {
  /** 索引を作り直したら、一覧を読み直させる。 */
  onChanged: () => void
}

const ICON = 14

/** 保存した直後だけ出す知らせ。 */
type Notice = { kind: 'saved' | 'rebuilt' | 'error'; text: string }

export function SettingsPane({ onChanged }: SettingsPaneProps) {
  const [config, setConfig] = useState<Config | null>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [category, setCategory] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  // 動いているサーバーが使っている場所。保存した設定と違うときに知らせる。
  const [runningDataDir, setRunningDataDir] = useState<string | null>(null)
  // 打っている途中の値。保存は明示の操作でだけ行う。
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [fetchInterval, setFetchInterval] = useState<number | null>(null)

  useEffect(() => {
    void api
      .config()
      .then((next) => {
        setConfig(next)
        setDataDir(next.dataDir)
        setFetchInterval(next.arxiv.fetchIntervalMinutes)
      })
      .catch((e: unknown) => setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) }))
    void api
      .health()
      .then((h) => setRunningDataDir(h.dataDir))
      .catch(() => setRunningDataDir(null))
    // モデルの選択肢は Codex から取る。固定の一覧は持たない(0003)。
    void api
      .models()
      .then((r) => setModels(r.models))
      .catch(() => setModels([]))
  }, [])

  const save = (patch: Partial<Config>, text = '保存した'): void => {
    void api
      .saveConfig(patch)
      .then((next) => {
        setConfig(next)
        setDataDir(next.dataDir)
        setFetchInterval(next.arxiv.fetchIntervalMinutes)
        setNotice({ kind: 'saved', text })
      })
      .catch((e: unknown) => setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) }))
  }

  const rebuild = (): void => {
    setRebuilding(true)
    void api
      .rebuildIndex()
      .then((result) => {
        setNotice({
          kind: 'rebuilt',
          text: `論文 ${result.papersIndexed} 件とチャット ${result.chatsIndexed} 件を読み直した。埋め込みは背景で作り直す。`,
        })
        onChanged()
      })
      .catch((e: unknown) => setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setRebuilding(false))
  }

  if (config === null) {
    return <p className="pane__empty">{notice?.text ?? '設定を読んでいます'}</p>
  }

  const efforts = models.find((m) => m.id === config.chat.defaultModel)?.efforts ?? []

  // 0 や空欄をそのまま送ると、サーバーが範囲外として捨てて既定値へ戻る。送らせない。
  const nextInterval = fetchInterval ?? config.arxiv.fetchIntervalMinutes
  const intervalChanged =
    Number.isInteger(nextInterval) && nextInterval >= 1 && nextInterval !== config.arxiv.fetchIntervalMinutes
  const nextDataDir = (dataDir ?? config.dataDir).trim()
  const dataDirChanged = nextDataDir.length > 0 && nextDataDir !== config.dataDir

  const addCategory = (): void => {
    const value = category.trim()
    if (value.length === 0 || config.arxiv.categories.includes(value)) return
    setCategory('')
    save({ arxiv: { ...config.arxiv, categories: [...config.arxiv.categories, value] } })
  }

  return (
    <div className="settings">
      {notice !== null && (
        <p className={notice.kind === 'error' ? 'error' : 'settings__notice'}>{notice.text}</p>
      )}

      <section className="settings__group">
        <h3>購読する arXiv のカテゴリ</h3>
        <ul className="settings__chips">
          {config.arxiv.categories.map((c) => (
            <li key={c}>
              {c}
              <button
                type="button"
                className="ghost"
                aria-label={`${c} をやめる`}
                onClick={() => save({ arxiv: { ...config.arxiv, categories: config.arxiv.categories.filter((x) => x !== c) } })}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="settings__row">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') addCategory()
            }}
            placeholder="cs.GR"
            aria-label="足すカテゴリ"
          />
          <button type="button" onClick={addCategory}>
            <Plus size={ICON} aria-hidden /> 足す
          </button>
        </div>
        <p className="settings__hint">足したカテゴリは次の取得から流れてくる。</p>
      </section>

      <section className="settings__group">
        <h3>フィードの取得間隔</h3>
        <div className="settings__row">
          <input
            type="number"
            min={1}
            value={fetchInterval ?? config.arxiv.fetchIntervalMinutes}
            onChange={(e) => setFetchInterval(Number(e.target.value))}
            aria-label="取得間隔(分)"
          />
          <span className="settings__unit">分</span>
          <button
            type="button"
            onClick={() => save({ arxiv: { ...config.arxiv, fetchIntervalMinutes: nextInterval } })}
            disabled={!intervalChanged}
          >
            <Check size={ICON} aria-hidden /> 保存
          </button>
        </div>
      </section>

      <section className="settings__group">
        <h3>チャットの既定</h3>
        <label className="settings__field">
          モデル
          <select
            value={config.chat.defaultModel}
            onChange={(e) => save({ chat: { ...config.chat, defaultModel: e.target.value } })}
          >
            {models.length === 0 && <option value={config.chat.defaultModel}>{config.chat.defaultModel}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="settings__field">
          reasoning effort
          <select
            value={config.chat.defaultEffort}
            onChange={(e) => save({ chat: { ...config.chat, defaultEffort: e.target.value } })}
          >
            {efforts.length === 0 && <option value={config.chat.defaultEffort}>{config.chat.defaultEffort}</option>}
            {efforts.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings__group">
        <h3>コレクションの置き場所</h3>
        <div className="settings__row">
          <input
            value={dataDir ?? config.dataDir}
            onChange={(e) => setDataDir(e.target.value)}
            aria-label="$PCT_DATA の場所"
          />
          <button
            type="button"
            onClick={() => save({ dataDir: nextDataDir }, '保存した。次に pct を起動したときから使う。')}
            disabled={!dataDirChanged}
          >
            <Check size={ICON} aria-hidden /> 変える
          </button>
        </div>
        {runningDataDir !== null && runningDataDir !== config.dataDir && (
          <p className="settings__hint settings__hint--warn">
            動いているサーバーは {runningDataDir} を使っている。起動し直すまで変わらない。
          </p>
        )}
        <p className="settings__hint">
          設定はこの場所の中には置かず、この PC の設定ファイルに保存する。中身は動かさないので、移すときは自分で移す。
        </p>
      </section>

      <section className="settings__group">
        <h3>検索の索引</h3>
        <button type="button" onClick={rebuild} disabled={rebuilding}>
          {rebuilding ? <Loader2 size={ICON} className="spin" aria-hidden /> : <RotateCcw size={ICON} aria-hidden />}
          索引を作り直す
        </button>
        <p className="settings__hint">
          markdown から作り直す。フィードの取得位置と未読は別に持っているので残る。
        </p>
      </section>
    </div>
  )
}
