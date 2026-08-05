import { Check, Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type CodexModel, type Config, type SavedPrompt } from '../api.ts'
import {
  FONT_SIZE_RANGE,
  FONT_SIZE_STEPS,
  LINE_HEIGHT_RANGE,
  LINE_HEIGHT_STEPS,
  READING_DEFAULT,
  type Reading,
} from '../useReading.ts'

export type SettingsPaneProps = {
  /** 索引を作り直したら、一覧を読み直させる。 */
  onChanged: () => void
  /** この端末に保存している読みやすさ。論文の本文とチャットに効く(#291)。 */
  reading: Reading
  onReadingChange: (next: Reading) => void
}

const ICON = 14

/** 保存した直後だけ出す知らせ。 */
type Notice = { kind: 'saved' | 'rebuilt' | 'error'; text: string }

export function SettingsPane({ onChanged, reading, onReadingChange }: SettingsPaneProps) {
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
  const [instructions, setInstructions] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null)
  // 目安の値から外れているときは、開いた時点でカスタムとして扱う。
  const [fontCustom, setFontCustom] = useState(() => !FONT_SIZE_STEPS.some((s) => s.value === reading.fontSize))
  const [lineCustom, setLineCustom] = useState(() => !LINE_HEIGHT_STEPS.some((s) => s.value === reading.lineHeight))

  useEffect(() => {
    void api
      .config()
      .then((next) => {
        setConfig(next)
        setDataDir(next.dataDir)
        setFetchInterval(next.arxiv.fetchIntervalMinutes)
        setInstructions(next.chat.instructions)
        setPrompts(next.chat.prompts)
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
        setInstructions(next.chat.instructions)
        setPrompts(next.chat.prompts)
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
  const nextPrompts = prompts ?? config.chat.prompts
  const promptsChanged = JSON.stringify(nextPrompts) !== JSON.stringify(config.chat.prompts)
  const editPrompt = (at: number, patch: Partial<SavedPrompt>): void => {
    setPrompts(nextPrompts.map((prompt, index) => (index === at ? { ...prompt, ...patch } : prompt)))
  }

  const nextInstructions = instructions ?? config.chat.instructions
  const instructionsChanged = nextInstructions !== config.chat.instructions

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
        <h3>呼び出せるプロンプト</h3>
        {nextPrompts.length === 0 ? <p className="settings__hint">まだ登録していない。</p> : null}
        <ul className="prompts">
          {nextPrompts.map((prompt, at) => (
            <li key={at} className="prompts__item">
              <div className="settings__row">
                <input
                  value={prompt.name}
                  onChange={(e) => editPrompt(at, { name: e.target.value })}
                  placeholder="名前(まとめ・査読など)"
                  aria-label={`${at + 1} 番目のプロンプトの名前`}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPrompts(nextPrompts.filter((_, index) => index !== at))}
                  aria-label={`${at + 1} 番目のプロンプトを消す`}
                >
                  <X size={ICON} aria-hidden />
                </button>
              </div>
              <textarea
                className="settings__instructions"
                value={prompt.body}
                onChange={(e) => editPrompt(at, { body: e.target.value })}
                rows={4}
                placeholder="この論文について、解決したい問題と手法と結果をまとめてください。"
                aria-label={`${at + 1} 番目のプロンプトの本文`}
              />
            </li>
          ))}
        </ul>
        <div className="settings__row">
          <button type="button" onClick={() => setPrompts([...nextPrompts, { name: '', body: '' }])}>
            <Plus size={ICON} aria-hidden /> 足す
          </button>
          <button
            type="button"
            onClick={() => save({ chat: { ...config.chat, prompts: nextPrompts } })}
            disabled={!promptsChanged}
          >
            <Check size={ICON} aria-hidden /> 保存
          </button>
        </div>
        <p className="settings__hint">よく使う質問を登録しておき、チャットの入力欄からすぐ呼び出すための設定。</p>
      </section>

      <section className="settings__group">
        <h3>読みやすさ(この端末だけ)</h3>
        <div className="settings__steps">
          <span className="settings__steps-label">文字の大きさ</span>
          {FONT_SIZE_STEPS.map((step) => (
            <button
              key={step.label}
              type="button"
              className={!fontCustom && reading.fontSize === step.value ? 'on' : ''}
              onClick={() => (setFontCustom(false), onReadingChange({ ...reading, fontSize: step.value }))}
            >
              {step.label}
            </button>
          ))}
          <button type="button" className={fontCustom ? 'on' : ''} onClick={() => setFontCustom(true)}>
            カスタム
          </button>
          {fontCustom && (
            <input
              type="number"
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={1}
              value={reading.fontSize}
              onChange={(e) => onReadingChange({ ...reading, fontSize: Number(e.target.value) })}
              aria-label="文字の大きさ(px)"
            />
          )}
        </div>
        <div className="settings__steps">
          <span className="settings__steps-label">行の高さ</span>
          {LINE_HEIGHT_STEPS.map((step) => (
            <button
              key={step.label}
              type="button"
              className={!lineCustom && reading.lineHeight === step.value ? 'on' : ''}
              onClick={() => (setLineCustom(false), onReadingChange({ ...reading, lineHeight: step.value }))}
            >
              {step.label}
            </button>
          ))}
          <button type="button" className={lineCustom ? 'on' : ''} onClick={() => setLineCustom(true)}>
            カスタム
          </button>
          {lineCustom && (
            <input
              type="number"
              min={LINE_HEIGHT_RANGE.min}
              max={LINE_HEIGHT_RANGE.max}
              step={0.1}
              value={reading.lineHeight}
              onChange={(e) => onReadingChange({ ...reading, lineHeight: Number(e.target.value) })}
              aria-label="行の高さ"
            />
          )}
        </div>
        <div className="settings__row">
          <button
            type="button"
            onClick={() => (setFontCustom(false), setLineCustom(false), onReadingChange(READING_DEFAULT))}
          >
            <RotateCcw size={ICON} aria-hidden /> 既定に戻す
          </button>
        </div>
        <p className="settings__hint">
          論文の本文にだけ効く。端末ごとに別々に覚えるので、スマホと PC で違う値にできる。
        </p>
      </section>

      <section className="settings__group">
        <h3>送信のキー</h3>
        <label className="settings__check">
          <input
            type="checkbox"
            checked={config.chat.sendOnEnter}
            onChange={(e) => save({ chat: { ...config.chat, sendOnEnter: e.target.checked } })}
          />
          Enter キーで送信
        </label>
        <label className="settings__check">
          <input
            type="checkbox"
            checked={config.chat.sendOnCtrlEnter}
            onChange={(e) => save({ chat: { ...config.chat, sendOnCtrlEnter: e.target.checked } })}
          />
          Ctrl+Enter キーで送信
        </label>
        <p className="settings__hint">
          どちらも外すと、送るのはボタンだけになる。`@` の候補が出ている間の Enter は、まず候補を選ぶ。
        </p>
      </section>

      <section className="settings__group">
        <h3>エージェントへの指示</h3>
        <textarea
          className="settings__instructions"
          value={nextInstructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="常体で答える。前置きを書かない。"
          aria-label="エージェントへの指示"
        />
        <div className="settings__row">
          <button
            type="button"
            onClick={() => save({ chat: { ...config.chat, instructions: nextInstructions } }, '保存した。次の発言から効く。')}
            disabled={!instructionsChanged}
          >
            <Check size={ICON} aria-hidden /> 保存
          </button>
        </div>
        <p className="settings__hint">
          口調や答え方をここで決める。新しい会話にも、続いている会話にも、次の発言から効く。
        </p>
      </section>

      <section className="settings__group">
        <h3>コレクションの置き場所</h3>
        <div className="settings__row">
          <input
            value={dataDir ?? config.dataDir}
            onChange={(e) => setDataDir(e.target.value)}
            aria-label="$CARREL_DATA の場所"
          />
          <button
            type="button"
            onClick={() => save({ dataDir: nextDataDir }, '保存した。次に carrel を起動したときから使う。')}
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
