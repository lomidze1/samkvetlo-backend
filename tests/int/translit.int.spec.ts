import { describe, expect, it } from 'vitest'

import { slugify } from '@/lib/translit'

// T1.2 acceptance: the plan's exact test vectors.
describe('slugify (T1.2)', () => {
  it.each([
    ['საეკლესიო ზარი', 'saeklesio-zari'],
    ['ბარძიმი შეკვეთით', 'bardzimi-shekvetit'],
    ['ჭურჭელი', 'churcheli'],
    ['წმინდა', 'tsminda'],
    ['ყუთი', 'quti'],
    ['ჟამი', 'zhami'],
    ['ღვინო', 'ghvino'],
    ['ზარი 50 კგ', 'zari-50-kg'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})
