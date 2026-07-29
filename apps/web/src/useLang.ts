import { useCallback, useEffect, useState } from 'react'

export type Lang = 'en' | 'ja'

const STORAGE_KEY = 'pct.lang'

function stored(): Lang {
  return window.localStorage.getItem(STORAGE_KEY) === 'ja' ? 'ja' : 'en'
}

/**
 * 一覧と本文で共通の表示言語。
 *
 * 論文ごとに切り替えるのではなく、コレクション全体をまとめて日本語で読むこと
 * を主な使い方とする。選んだ言語は次に開いたときも保つ。
 */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(stored)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang)
  }, [lang])

  return [lang, useCallback((next: Lang) => setLang(next), [])]
}
