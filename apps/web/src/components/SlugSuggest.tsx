import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'

export type SlugSuggestProps = {
  slugs: string[]
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/** 候補に出す数の上限。 */
const LIMIT = 8

/** 入力欄の高さの下限と上限(px)。上限を超えたら中でスクロールさせる。 */
const MIN_HEIGHT = 96
const MAX_HEIGHT = 320

/** 入力中の `@` から後ろの、まだ空白に達していない部分。 */
const TYPING = /@([a-z0-9-]*)$/

export function SlugSuggest({ slugs, value, onChange, inputRef }: SlugSuggestProps) {
  const [at, setAt] = useState(0)
  // Escape を押したかどうか。押すまでは Tab を入力欄の中で受け、押した後は
  // 隣の部品へ抜けさせる。文章を書いている間に焦点が飛ばないようにするため。
  const [escaped, setEscaped] = useState(false)

  const typing = useMemo(() => {
    const match = TYPING.exec(value)
    return match === null ? null : (match[1] as string)
  }, [value])

  const candidates = useMemo(() => {
    if (typing === null || escaped) return []
    // slug は人間が読める形なので、著者名や略称の断片から絞り込める(0006)。
    return slugs.filter((slug) => slug.includes(typing)).slice(0, LIMIT)
  }, [slugs, typing, escaped])

  // 内容に合わせて縦に伸ばす。長文を書いている途中で入力欄が窓になるのを避ける。
  useEffect(() => {
    const node = inputRef.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(Math.max(node.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`
  }, [value, inputRef])

  const complete = (slug: string): void => {
    onChange(value.replace(TYPING, `@${slug} `))
    setAt(0)
    inputRef.current?.focus()
  }

  /** 打った位置にタブ文字を入れる。 */
  const insertTab = (node: HTMLTextAreaElement): void => {
    const start = node.selectionStart
    const end = node.selectionEnd
    onChange(`${value.slice(0, start)}\t${value.slice(end)}`)
    // 値の反映は次の描画なので、位置の復元もそこへ回す。
    requestAnimationFrame(() => {
      node.selectionStart = start + 1
      node.selectionEnd = start + 1
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      setEscaped(true)
      return
    }
    // IME の変換中は、確定の Enter が候補の確定に取られないようにする。
    if (event.nativeEvent.isComposing) return

    if (event.key === 'Tab') {
      if (candidates.length > 0) {
        event.preventDefault()
        complete(candidates[at] as string)
        return
      }
      // Escape を押すまでは、Tab は入力欄の中の字下げとして扱う。
      if (!escaped) {
        event.preventDefault()
        insertTab(event.currentTarget)
      }
      return
    }

    if (candidates.length === 0) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setAt((previous) => (previous + 1) % candidates.length)
        return
      case 'ArrowUp':
        event.preventDefault()
        setAt((previous) => (previous - 1 + candidates.length) % candidates.length)
        return
      case 'Enter':
        event.preventDefault()
        complete(candidates[at] as string)
        return
      default:
        return
    }
  }

  return (
    <div className="suggest">
      {candidates.length > 0 && (
        <ul className="suggest__list">
          {candidates.map((slug, index) => (
            <li key={slug}>
              <button type="button" className={index === at ? 'on' : ''} onClick={() => complete(slug)}>
                {slug}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setEscaped(false)
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
        placeholder="@ で論文を指して質問する(送信は送るボタン。Escape で欄を離れる)"
      />
    </div>
  )
}
