import { useMemo, useState, type KeyboardEvent, type RefObject } from 'react'

export type SlugSuggestProps = {
  slugs: string[]
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/** 候補に出す数の上限。 */
const LIMIT = 8

/** 入力中の `@` から後ろの、まだ空白に達していない部分。 */
const TYPING = /@([a-z0-9-]*)$/

export function SlugSuggest({ slugs, value, onChange, onSubmit, inputRef }: SlugSuggestProps) {
  const [at, setAt] = useState(0)

  const typing = useMemo(() => {
    const match = TYPING.exec(value)
    return match === null ? null : (match[1] as string)
  }, [value])

  const candidates = useMemo(() => {
    if (typing === null) return []
    // slug は人間が読める形なので、著者名や略称の断片から絞り込める(0006)。
    return slugs.filter((slug) => slug.includes(typing)).slice(0, LIMIT)
  }, [slugs, typing])

  const complete = (slug: string): void => {
    onChange(value.replace(TYPING, `@${slug} `))
    setAt(0)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (candidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setAt((previous) => (previous + 1) % candidates.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setAt((previous) => (previous - 1 + candidates.length) % candidates.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        complete(candidates[at] as string)
        return
      }
      if (event.key === 'Escape') {
        setAt(0)
        onChange(`${value} `)
        return
      }
    }
    // 改行は Shift を押しながら。単独の Enter は送信にする。
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="@ で論文を指して質問する"
        rows={3}
      />
    </div>
  )
}
