// Georgian -> Latin transliteration for slugs (ADR national system).
const GEORGIAN_TO_LATIN: Record<string, string> = {
  ა: 'a',
  ბ: 'b',
  გ: 'g',
  დ: 'd',
  ე: 'e',
  ვ: 'v',
  ზ: 'z',
  თ: 't',
  ი: 'i',
  კ: 'k',
  ლ: 'l',
  მ: 'm',
  ნ: 'n',
  ო: 'o',
  პ: 'p',
  ჟ: 'zh',
  რ: 'r',
  ს: 's',
  ტ: 't',
  უ: 'u',
  ფ: 'p',
  ქ: 'k',
  ღ: 'gh',
  ყ: 'q',
  შ: 'sh',
  ჩ: 'ch',
  ც: 'ts',
  ძ: 'dz',
  წ: 'ts',
  ჭ: 'ch',
  ხ: 'kh',
  ჯ: 'j',
  ჰ: 'h',
}

/** Transliterates Georgian letters to Latin; non-Georgian characters pass through unchanged. */
export function transliterate(input: string): string {
  return Array.from(input)
    .map((char) => GEORGIAN_TO_LATIN[char] ?? char)
    .join('')
}

/** Transliterates and slugifies: lowercase, ASCII alphanumerics joined by single dashes. */
export function slugify(input: string): string {
  const transliterated = transliterate(input.toLowerCase())
  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
