import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { IndexDb } from '../db/index-db.ts'
import { listChatFiles, readChat } from './chat.ts'
import { CHATS_DIR, chatsDir, PAPERS_DIR, papersDir } from './layout.ts'
import { deletePaperDir, listPaperSlugs, readPaper } from './paper.ts'

export type ScanResult = {
  papersIndexed: number
  papersRemoved: number
  chatsIndexed: number
  chatsRemoved: number
}

/** まだ全段階が終わっていない論文を教える口。 */
export type IncompleteImports = () => Set<string>

export type CollectionEvents = {
  onPaperChanged?: (slug: string) => void
  onPaperRemoved?: (slug: string) => void
  onChatChanged?: (path: string) => void
  onChatRemoved?: (path: string) => void
}

export class Collection {
  readonly #dataDir: string
  readonly #index: IndexDb
  readonly #events: CollectionEvents
  readonly #incomplete: IncompleteImports
  #watchers: FSWatcher[] = []
  #pending = new Map<string, NodeJS.Timeout>()

  constructor(
    dataDir: string,
    index: IndexDb,
    events: CollectionEvents = {},
    incomplete: IncompleteImports = () => new Set(),
  ) {
    this.#dataDir = dataDir
    this.#index = index
    this.#events = events
    this.#incomplete = incomplete
  }

  async ensureDirs(): Promise<void> {
    await mkdir(papersDir(this.#dataDir), { recursive: true })
    await mkdir(chatsDir(this.#dataDir), { recursive: true })
  }

  /**
   * `$PCT_DATA` 全体を走査して索引を合わせる。
   *
   * 更新時刻が索引と同じものは読み直さない。停止中に外部から編集された
   * ファイルと、索引には有るがファイルが消えたものを、ここで拾う。
   */
  async scan(): Promise<ScanResult> {
    const result: ScanResult = { papersIndexed: 0, papersRemoved: 0, chatsIndexed: 0, chatsRemoved: 0 }

    const knownPapers = this.#index.paperFingerprints()
    const slugs = await listPaperSlugs(this.#dataDir)
    for (const slug of slugs) {
      const known = knownPapers.get(slug)
      knownPapers.delete(slug)
      if (await this.#indexPaper(slug, known?.mtimeMs, known?.bodyHash)) result.papersIndexed += 1
    }
    for (const slug of knownPapers.keys()) {
      this.#index.deletePaper(slug)
      this.#events.onPaperRemoved?.(slug)
      result.papersRemoved += 1
    }

    const knownChats = this.#index.chatFingerprints()
    const files = await listChatFiles(this.#dataDir)
    for (const file of files) {
      const path = relative(this.#dataDir, file)
      const known = knownChats.get(path)
      knownChats.delete(path)
      if (await this.#indexChat(file, known)) result.chatsIndexed += 1
    }
    for (const path of knownChats.keys()) {
      this.#index.deleteChatByPath(path)
      this.#events.onChatRemoved?.(path)
      result.chatsRemoved += 1
    }

    return result
  }

  async #indexPaper(slug: string, knownMtimeMs?: number, knownBodyHash?: string): Promise<boolean> {
    if (this.#incomplete().has(slug)) {
      // 索引に載った後で未完了に戻ることがある(取り込み済みの論文を同じ slug で
      // 取り込み直した場合など)ので、載っていたものは外す。
      if (knownMtimeMs !== undefined) {
        this.#index.deletePaper(slug)
        this.#events.onPaperRemoved?.(slug)
      }
      return false
    }

    const paper = await readPaper(this.#dataDir, slug)
    if (paper === null) {
      if (knownMtimeMs !== undefined) {
        this.#index.deletePaper(slug)
        this.#events.onPaperRemoved?.(slug)
      }
      return false
    }
    if (knownMtimeMs !== undefined && paper.mtimeMs === knownMtimeMs) return false

    // 本文が変わったときだけ埋め込みを作り直す。frontmatter だけの編集で
    // GPU を回さないようにする。
    const bodyChanged = knownBodyHash === undefined || knownBodyHash !== paper.bodyHash
    this.#index.upsertPaper(paper, bodyChanged)
    this.#events.onPaperChanged?.(slug)
    return true
  }

  async #indexChat(absolutePath: string, knownMtimeMs?: number): Promise<boolean> {
    const chat = await readChat(this.#dataDir, absolutePath)
    if (chat === null) {
      const path = relative(this.#dataDir, absolutePath)
      if (knownMtimeMs !== undefined) {
        this.#index.deleteChatByPath(path)
        this.#events.onChatRemoved?.(path)
      }
      return false
    }
    if (knownMtimeMs !== undefined && chat.mtimeMs === knownMtimeMs) return false

    this.#index.upsertChat(chat)
    this.#events.onChatChanged?.(chat.path)
    return true
  }

  /**
   * 会話 1 つを読み直して索引へ載せる。
   *
   * pct 自身が会話を書き換えたときに呼ぶ。ファイルの監視は外からの編集を拾うため
   * の仕掛けなので、自分の書き込みをそれに任せない。
   */
  async reloadChat(absolutePath: string): Promise<void> {
    await this.#indexChat(absolutePath)
  }

  /** 論文を削除する。ファイルを消してから索引を消す。 */
  async deletePaper(slug: string): Promise<void> {
    await deletePaperDir(this.#dataDir, slug)
    this.#index.deletePaper(slug)
    this.#events.onPaperRemoved?.(slug)
  }

  /** 稼働中の編集を拾う。書き込みの途中で何度も発火するので、少し待ってから読む。 */
  startWatching(debounceMs = 250): void {
    this.stopWatching()
    for (const [root, kind] of [
      [papersDir(this.#dataDir), PAPERS_DIR],
      [chatsDir(this.#dataDir), CHATS_DIR],
    ] as const) {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename === null) return
        this.#schedule(kind, filename.toString(), debounceMs)
      })
      watcher.on('error', () => this.stopWatching())
      this.#watchers.push(watcher)
    }
  }

  stopWatching(): void {
    for (const watcher of this.#watchers) watcher.close()
    this.#watchers = []
    for (const timer of this.#pending.values()) clearTimeout(timer)
    this.#pending.clear()
  }

  #schedule(kind: typeof PAPERS_DIR | typeof CHATS_DIR, filename: string, debounceMs: number): void {
    const target = this.#resolveTarget(kind, filename)
    if (target === null) return

    const existing = this.#pending.get(target.key)
    if (existing !== undefined) clearTimeout(existing)
    this.#pending.set(
      target.key,
      setTimeout(() => {
        this.#pending.delete(target.key)
        void this.#applyChange(target)
      }, debounceMs),
    )
  }

  #resolveTarget(
    kind: typeof PAPERS_DIR | typeof CHATS_DIR,
    filename: string,
  ): { key: string; kind: 'paper'; slug: string } | { key: string; kind: 'chat'; absolutePath: string } | null {
    const segments = filename.split(sep).filter((s) => s.length > 0)
    if (segments.length === 0) return null

    if (kind === PAPERS_DIR) {
      const slug = segments[0] as string
      return { key: `paper:${slug}`, kind: 'paper', slug }
    }

    const name = segments[segments.length - 1] as string
    if (!name.endsWith('.md') || name.startsWith('.')) return null
    const absolutePath = join(chatsDir(this.#dataDir), ...segments)
    return { key: `chat:${absolutePath}`, kind: 'chat', absolutePath }
  }

  async #applyChange(
    target: { kind: 'paper'; slug: string } | { kind: 'chat'; absolutePath: string },
  ): Promise<void> {
    try {
      if (target.kind === 'paper') {
        const known = this.#index.paperFingerprints().get(target.slug)
        await this.#indexPaper(target.slug, known?.mtimeMs, known?.bodyHash)
      } else {
        const path = relative(this.#dataDir, target.absolutePath)
        await this.#indexChat(target.absolutePath, this.#index.chatFingerprints().get(path))
      }
    } catch (error) {
      console.error('索引の更新に失敗した', target, error)
    }
  }
}
