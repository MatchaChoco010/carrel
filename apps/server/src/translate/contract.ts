/**
 * 翻訳に課した契約が守られたかを確かめる。
 *
 * 数式・図の参照・リンク・脚注の参照は訳す対象ではなく、原文と訳文で同一で
 * あるべきものである(0004)。翻訳の過程で LaTeX が壊れると、照合の段階で
 * 直した意味が失われる。
 */

/** 表示のための数式(`$$...$$`)と、文中の数式(`$...$`)。 */
const DISPLAY_MATH = /\$\$([\s\S]*?)\$\$/g
const INLINE_MATH = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g
/** 画像の参照とリンク。 */
const IMAGE = /!\[[^\]]*\]\(([^)]*)\)/g
const LINK = /(?<!!)\[[^\]]*\]\(([^)]*)\)/g
/** 見出しの深さ。 */
const HEADING = /^(#{1,6})\s+/gm

export type ContractBreach = {
  kind: 'math' | 'image' | 'link' | 'heading'
  /** 原文にあって訳文に無いもの。 */
  missing: string[]
  /** 訳文にあって原文に無いもの。 */
  added: string[]
}

function collect(text: string, pattern: RegExp, group: number): string[] {
  const out: string[] = []
  for (const m of text.matchAll(pattern)) out.push((m[group] ?? '').trim())
  return out.filter((s) => s.length > 0)
}

/** 出現数で比べる。並びは訳文で変わりうるので順序は問わない。 */
function diff(source: string[], target: string[]): { missing: string[]; added: string[] } {
  const count = (list: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const v of list) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }
  const want = count(source)
  const got = count(target)
  const missing: string[] = []
  const added: string[] = []
  for (const [v, n] of want) {
    for (let i = 0; i < n - (got.get(v) ?? 0); i += 1) missing.push(v)
  }
  for (const [v, n] of got) {
    for (let i = 0; i < n - (want.get(v) ?? 0); i += 1) added.push(v)
  }
  return { missing, added }
}

/**
 * 原文と訳文を突き合わせ、契約に反する箇所を返す。
 *
 * 空の配列が返れば契約は守られている。
 */
export function checkContract(source: string, target: string): ContractBreach[] {
  const breaches: ContractBreach[] = []

  const math = diff(
    [...collect(source, DISPLAY_MATH, 1), ...collect(source, INLINE_MATH, 1)],
    [...collect(target, DISPLAY_MATH, 1), ...collect(target, INLINE_MATH, 1)],
  )
  if (math.missing.length > 0 || math.added.length > 0) breaches.push({ kind: 'math', ...math })

  const image = diff(collect(source, IMAGE, 1), collect(target, IMAGE, 1))
  if (image.missing.length > 0 || image.added.length > 0) breaches.push({ kind: 'image', ...image })

  const link = diff(collect(source, LINK, 1), collect(target, LINK, 1))
  if (link.missing.length > 0 || link.added.length > 0) breaches.push({ kind: 'link', ...link })

  const heading = diff(collect(source, HEADING, 1), collect(target, HEADING, 1))
  if (heading.missing.length > 0 || heading.added.length > 0) {
    breaches.push({ kind: 'heading', ...heading })
  }

  return breaches
}

const KIND_LABELS: Record<ContractBreach['kind'], string> = {
  math: '数式',
  image: '図の参照',
  link: 'リンク',
  heading: '見出しの階層',
}

export function describeBreaches(breaches: ContractBreach[]): string {
  return breaches
    .map((b) => {
      const parts: string[] = []
      if (b.missing.length > 0) parts.push(`落ちた ${b.missing.length} 件: ${sample(b.missing)}`)
      if (b.added.length > 0) parts.push(`増えた ${b.added.length} 件: ${sample(b.added)}`)
      return `${KIND_LABELS[b.kind]}(${parts.join(' / ')})`
    })
    .join('、')
}

function sample(values: string[]): string {
  return values
    .slice(0, 3)
    .map((v) => (v.length > 40 ? `${v.slice(0, 37)}…` : v))
    .join(' | ')
}
