import { useCallback, useEffect, useState } from 'react'

export type Lang = 'en' | 'ja'

const STORAGE_KEY = 'pct.lang'

function stored(): Lang {
  return window.localStorage.getItem(STORAGE_KEY) === 'ja' ? 'ja' : 'en'
}

/** 表示する言語。論文ごとではなくコレクション全体で 1 つ持つ。 */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(stored)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang)
  }, [lang])

  return [lang, useCallback((next: Lang) => setLang(next), [])]
}
