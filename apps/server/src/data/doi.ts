/**
 * DOI を突き合わせに使える形に揃える。
 *
 * 書き方は揺れる。`https://doi.org/` や `doi:` の前置きを落とし、`10.` から始まる
 * 形にする。そう読めない値は DOI として扱わない。
 */
export function normalizeDoi(value: string | null): string | null {
  if (value === null) return null
  const stripped = value.replace(/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').trim()
  return /^10\.\S+\/\S+$/.test(stripped) ? stripped : null
}
