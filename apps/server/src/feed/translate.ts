import { inBatches } from '../batches.ts'
import type { CodexClient } from '../codex/client.ts'
import { textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import type { FeedStore } from './store.ts'

/**
 * フィードの abstract に与える指示。
 *
 * 本文の節を訳す指示は markdown の構造を保つことを課すので、それを流用すると
 * 訳文へ見出しが足される。フィードに並ぶのは地の文だけである。
 */
const INSTRUCTIONS = `あなたは英語の論文の abstract を日本語へ訳す。
出力は訳文そのものだけである。見出し・箇条書き・前置き・注釈を付けない。

数式と LaTeX の命令は原文のまま残す。
技術用語は、日本語の技術文書で慣例的に使われる語を選ぶ。定訳が無い用語は英語のまま残してよい。
原文に無い内容を足さない。原文にある内容を落とさない。`

export type FeedTranslateDeps = {
  feed: FeedStore
  codex: CodexClient
  model: string
  effort: string
  serviceTier: string | null
}

const ITEMS_AT_ONCE = 8

function buildPrompt(title: string, abstract: string): string {
  return [`論文「${title}」の abstract を訳せ。`, '', '## 訳す abstract', '', abstract].join('\n')
}

/** 指示しても見出しが付いてくることがあるので、先頭の見出しは落とす。 */
function stripHeading(text: string): string {
  return text.replace(/^#{1,6} .*\n+/, '').trim()
}

/** 和訳がまだ無いフィードの項目を訳す。 */
export async function translateFeed(deps: FeedTranslateDeps): Promise<number> {
  const pending = deps.feed.needsTranslation()
  if (pending.length === 0) return 0

  const done = await inBatches(pending, ITEMS_AT_ONCE, async (item) => {
    const threadId = await startWorkThread(deps.codex, {
      instructions: INSTRUCTIONS,
      model: deps.model,
      serviceTier: deps.serviceTier,
    })
    const outcome = await runTurn(deps.codex, {
      threadId,
      input: textInput(buildPrompt(item.title, item.abstract ?? '')),
      effort: deps.effort,
    })
    return { arxivId: item.arxivId, markdown: stripHeading(outcome.text.trim()) }
  })

  for (const item of done) {
    if (item.markdown.length > 0) deps.feed.setAbstractJa(item.arxivId, item.markdown)
  }
  return done.filter((d) => d.markdown.length > 0).length
}
