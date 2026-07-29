import { Search, X } from 'lucide-react'
import type { SearchFilter } from '../api.ts'

export type PaperFiltersProps = {
  query: string
  filter: SearchFilter
  tags: Array<{ tag: string; count: number }>
  onQueryChange: (query: string) => void
  onFilterChange: (filter: SearchFilter) => void
}

const ICON = 16

function toYear(value: string): number | undefined {
  if (value.trim().length === 0) return undefined
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function PaperFilters({ query, filter, tags, onQueryChange, onFilterChange }: PaperFiltersProps) {
  const set = <K extends keyof SearchFilter>(key: K, value: SearchFilter[K]): void => {
    const next = { ...filter }
    if (value === undefined || (Array.isArray(value) && value.length === 0) || value === '') delete next[key]
    else next[key] = value
    onFilterChange(next)
  }

  const selected = filter.tags ?? []
  const toggleTag = (tag: string): void =>
    set('tags', selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag])

  const active =
    query.length > 0 || Object.keys(filter).length > 0

  return (
    <div className="filters">
      <div className="filters-main">
        <Search size={ICON} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="本文を検索(日本語でも英語の論文が当たる)"
          aria-label="本文の検索"
        />
        {active ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onQueryChange('')
              onFilterChange({})
            }}
          >
            <X size={ICON} aria-hidden /> 条件を消す
          </button>
        ) : null}
      </div>

      <div className="filters-row">
        <input
          value={filter.title ?? ''}
          onChange={(e) => set('title', e.target.value)}
          placeholder="タイトル"
          aria-label="タイトルの部分一致"
        />
        <input
          value={filter.author ?? ''}
          onChange={(e) => set('author', e.target.value)}
          placeholder="著者"
          aria-label="著者"
        />
        <input
          value={filter.venue ?? ''}
          onChange={(e) => set('venue', e.target.value)}
          placeholder="学会名"
          aria-label="学会名"
        />
        <input
          className="year"
          inputMode="numeric"
          value={filter.yearFrom === undefined ? '' : String(filter.yearFrom)}
          onChange={(e) => set('yearFrom', toYear(e.target.value))}
          placeholder="年から"
          aria-label="出版年の下限"
        />
        <input
          className="year"
          inputMode="numeric"
          value={filter.yearTo === undefined ? '' : String(filter.yearTo)}
          onChange={(e) => set('yearTo', toYear(e.target.value))}
          placeholder="年まで"
          aria-label="出版年の上限"
        />
      </div>

      {tags.length > 0 ? (
        <div className="filters-tags">
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={selected.includes(tag) ? 'tag on' : 'tag'}
              onClick={() => toggleTag(tag)}
              aria-pressed={selected.includes(tag)}
            >
              {tag} <span className="count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
