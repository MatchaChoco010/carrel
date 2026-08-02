import { useCallback, useEffect, useState } from 'react'

export type Reading = {
  /** 読む文字の大きさ(px)。 */
  fontSize: number
  /** 読む文字の行の高さ(文字の大きさに対する倍率)。 */
  lineHeight: number
}

const STORAGE_KEY = 'pct.reading'

export const READING_DEFAULT: Reading = { fontSize: 14, lineHeight: 1.8 }

export const FONT_SIZE_RANGE = { min: 12, max: 24 }
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.4 }

/** 3 段階の目安。これ以外の値はカスタムとして数値で受ける。 */
export const FONT_SIZE_STEPS = [
  { label: '小', value: 13 },
  { label: '中', value: 14 },
  { label: '大', value: 18 },
]

export const LINE_HEIGHT_STEPS = [
  { label: '小', value: 1.6 },
  { label: '中', value: 1.8 },
  { label: '大', value: 2.1 },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function stored(): Reading {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return READING_DEFAULT
  try {
    const parsed = JSON.parse(raw) as Partial<Reading>
    return {
      fontSize:
        typeof parsed.fontSize === 'number'
          ? clamp(parsed.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
          : READING_DEFAULT.fontSize,
      lineHeight:
        typeof parsed.lineHeight === 'number'
          ? clamp(parsed.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
          : READING_DEFAULT.lineHeight,
    }
  } catch {
    return READING_DEFAULT
  }
}

/**
 * 読みやすさの設定。論文の本文とチャットの両方に効く(#291)。
 *
 * この端末にだけ保存する。スマホと PC では読みやすい大きさが違うので、
 * サーバーの設定に 1 つ持つと片方に合わせるともう片方が読みにくくなる。
 */
export function useReading(): [Reading, (next: Reading) => void] {
  const [reading, setReading] = useState<Reading>(stored)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reading))
    const root = document.documentElement
    root.style.setProperty('--reading-font-size', `${reading.fontSize}px`)
    root.style.setProperty('--reading-line-height', String(reading.lineHeight))
  }, [reading])

  return [reading, useCallback((next: Reading) => setReading(next), [])]
}
