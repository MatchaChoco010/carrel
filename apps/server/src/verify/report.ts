import type { TextGap } from './diff.ts'
import type { VerifyChange } from './prompt.ts'

export type PageReport = {
  page: number
  changes: VerifyChange[]
  /** 照合の後にも残った文字の欠落。無ければ null。 */
  remaining: TextGap | null
  /** 突き合わせる相手が無く、紙面の画像から書き起こしたページ。 */
  transcribed: boolean
}

const KIND_LABELS: Record<VerifyChange['kind'], string> = {
  characters: '文字',
  structure: '構造',
  missing: '欠落',
  undecided: '未決',
}

const SOURCE_LABELS: Record<VerifyChange['source'], string> = {
  textLayer: '文字層',
  pageImage: 'ページ画像',
  none: '変更なし',
}

/**
 * 変更点の記録を組み立てる。
 *
 * 照合の結果が正しいことを機械的に確かめる手段は無いので(0004)、何をどう変えた
 * かを理由つきで残し、人が原本と突き合わせられる状態を保つ。あわせて、照合を
 * 経ても残った文字の欠落を記録する。文字の欠落という 1 つの事象に限れば機械的
 * に確かめられる(0009)。
 */
export function buildReport(reports: PageReport[]): string {
  const lines: string[] = []
  const changed = reports.filter((r) => r.changes.length > 0)
  const withRemaining = reports.filter((r) => r.remaining !== null)
  const transcribed = reports.filter((r) => r.transcribed)

  lines.push('# 照合の記録', '')
  lines.push(
    `${reports.length} ページを突き合わせ、${changed.length} ページで ${countChanges(reports)} 箇所を変更した。`,
  )
  if (withRemaining.length > 0) {
    lines.push(`${withRemaining.length} ページに、照合の後も文字の欠落が残っている。`)
  }
  if (transcribed.length > 0) {
    lines.push('')
    lines.push('## 書き起こしたページ', '')
    lines.push(
      `次のページには PDF に埋め込まれた文字が無く、紙面の画像から書き起こした: ${transcribed.map((r) => r.page + 1).join(', ')}。`,
    )
    lines.push('突き合わせる相手が無いので、固有名詞や数値の読み違いが残っていても検出できない。')
  }
  lines.push('')

  for (const report of reports) {
    if (report.changes.length === 0 && report.remaining === null) continue
    lines.push(`## ${report.page + 1} ページ目`, '')

    if (report.changes.length > 0) {
      lines.push('| 種類 | 採った側 | 変換結果 | 確定 | 理由 |')
      lines.push('|---|---|---|---|---|')
      for (const change of report.changes) {
        lines.push(
          `| ${KIND_LABELS[change.kind]} | ${SOURCE_LABELS[change.source]} | ${cell(change.before)} | ${cell(change.after)} | ${cell(change.reason)} |`,
        )
      }
      lines.push('')
    }

    if (report.remaining !== null) {
      const gap = report.remaining
      lines.push(
        `照合の後も ${gap.lost}/${gap.total} 文字が文字層と一致しない (例: ${gap.samples.join(' ')})。`,
        '',
      )
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function countChanges(reports: PageReport[]): number {
  return reports.reduce((sum, r) => sum + r.changes.length, 0)
}

/** 表の升に入れる。改行と縦棒は表を壊すので置き換える。 */
function cell(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat
}
