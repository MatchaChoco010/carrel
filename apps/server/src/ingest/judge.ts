import type { CodexClient } from '../codex/client.ts'
import { imagesAndTextInput, textInput } from '../codex/protocol.ts'
import { runTurn, startWorkThread } from '../codex/threads.ts'
import type { OriginalHead } from './head.ts'

/** 判定に渡す、頼んだ論文の書誌(0025)。 */
export type AskedPaper = {
  title: string
  authors: string[]
  year: number | null
}

/**
 * 取れた原本が頼んだ論文かどうか(0025)。
 *
 * 違うときの `reason` は、取得が失敗したときに一覧へ出す。「頼んだ論文ではなかった」
 * だけでは、所在が悪いのか論文が公開されていないのかが読み取れない。
 */
export type Judgement = { same: true } | { same: false; reason: string }

/** 先頭の文字をどれだけ渡すか。表紙と 1 ページ目が入れば足りる。 */
const HEAD_CHARS = 12000

const INSTRUCTIONS = [
  'あなたは、渡された文書が指定の論文そのものかを判じる。',
  '判じる材料は、論文の書誌(題・著者・出版年)と、その文書の先頭 2 ページである。',
  '同じ論文であれば same を true にする。',
  '次のものは same を false にし、何であったかを kind と reason に書く。',
  '- 論文ではない文書(企業の文書、契約や規約、案内、スライドなど)。',
  '- その論文に付随する別の文書(補足資料、発表の資料、その論文を引用した特許など)。',
  '- 別の論文(同じ著者の別の研究、題の語が重なる無関係な論文、別の刊行物など)。',
  '題や著者が文書の中に出てくることは、同じ論文である根拠にならない。',
  '付随する文書も引用した特許も、題と著者をそのまま含む。中身がその論文の本体かを見る。',
  '題の書き方の揺れ(副題の有無、記号、大文字と小文字)は違いとみなさない。',
  'reason は日本語で 1 文。何であったかが分かるように書く。',
  '要求された JSON だけを返す。',
].join('\n')

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    same: { type: 'boolean', description: '渡された文書が、その書誌の論文そのものなら true。' },
    kind: {
      type: 'string',
      enum: ['same', 'not-a-paper', 'related-document', 'other-paper'],
      description: 'same が false のとき、何であったか。',
    },
    reason: { type: 'string', description: '日本語で 1 文。same が true のときは空でよい。' },
  },
  required: ['same', 'kind', 'reason'],
  additionalProperties: false,
}

/** 書誌を、判定の問い合わせに載せる形にする。 */
function describe(asked: AskedPaper): string {
  const lines = [`題: ${asked.title}`]
  if (asked.authors.length > 0) lines.push(`著者: ${asked.authors.join(', ')}`)
  if (asked.year !== null) lines.push(`出版年: ${asked.year}`)
  return lines.join('\n')
}

function parse(text: string): Judgement | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const parsed = raw as Record<string, unknown>
  if (parsed['same'] === true) return { same: true }
  if (parsed['same'] !== false) return null
  const reason = typeof parsed['reason'] === 'string' ? parsed['reason'].trim() : ''
  const kind = typeof parsed['kind'] === 'string' ? parsed['kind'] : ''
  return { same: false, reason: reason.length > 0 ? reason : `頼んだ論文ではなかった (${kind})` }
}

export type JudgeDeps = {
  codex: CodexClient
  model: string
}

/**
 * 取れた原本が頼んだ論文かを判じる(0025)。
 *
 * 文字の重なりでは決まらない。その論文を引用した特許、発表のスライド、補足資料、同じ
 * 著者の別の論文は、題と著者をそのまま含む。中身を読める相手に判じさせる。
 *
 * 判定そのものが行えなかったときは投げる。確かめずに受け取ると、この判定が防ごうと
 * しているものが素通りするためである。
 */
export async function judgeOriginal(head: OriginalHead, asked: AskedPaper, deps: JudgeDeps): Promise<Judgement> {
  const threadId = await startWorkThread(deps.codex, { instructions: INSTRUCTIONS, model: deps.model })
  const question = `次の論文を探している。\n\n${describe(asked)}\n\n取れた文書の先頭は次のとおりである。この文書はその論文そのものか。`
  const outcome = await runTurn(deps.codex, {
    threadId,
    input:
      head.kind === 'text'
        ? textInput(`${question}\n\n${head.text.slice(0, HEAD_CHARS)}`)
        : imagesAndTextInput(head.files, question),
    effort: 'low',
    outputSchema: OUTPUT_SCHEMA,
  })

  const judged = parse(outcome.text)
  if (judged === null) throw new Error('取れた原本が頼んだ論文かを判じられなかった')
  return judged
}
