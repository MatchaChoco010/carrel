/**
 * 参考文献を 1 件ずつに直す指示。
 *
 * 薄いままにしてある。形ごとの決まりや落とすものの例を足した版も試したが、
 * 結果は変わらなかった(0015)。
 */
export const REFERENCES_INSTRUCTIONS = [
  'あなたは論文の参考文献の一覧を、1 件ずつの構造化された形に直す。',
  '渡された文字列は、論文の参考文献の節をそのまま取り出したものである。',
  '要求された JSON だけを返す。',
].join('\n')

export const REFERENCES_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '書かれていたままの 1 件。番号や記号の印は落とす。' },
          title: { type: 'string', description: '文献の題だけ。掲載誌・会議・巻・ページは含めない。' },
          authors: { type: 'array', items: { type: 'string' } },
          year: { type: ['integer', 'null'] },
          arxivId: { type: ['string', 'null'] },
          doi: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          kind: {
            type: 'string',
            enum: ['paper', 'other'],
            description: '論文なら paper。web ページ・規格・道具の説明なら other。',
          },
        },
        required: ['text', 'title', 'authors', 'year', 'arxivId', 'doi', 'url', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
}

export function buildReferencesPrompt(section: string): string {
  return `次の参考文献の節を 1 件ずつに直せ。\n\n---\n${section}\n---`
}
