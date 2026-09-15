// ADR 0006: National Bank of Georgia daily rates. The API returns
// `[{ date, currencies: [{ code, quantity, rate, ... }] }]`; the unit rate
// is `rate / quantity` (RUB is quoted per 100 ₽, USD per 1 $).
const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json'

export interface NbgCurrencyEntry {
  code: string
  quantity: number
  rate: number
}

export interface NbgDayEntry {
  currencies: NbgCurrencyEntry[]
  date: string
}

export interface NbgRates {
  /** ISO date the rates apply from. */
  date: string
  rubGel: number
  usdGel: number
}

export function parseNbgRates(response: NbgDayEntry[]): NbgRates {
  const day = response[0]
  if (!day) throw new Error('NBG response is empty')

  const rub = day.currencies.find((entry) => entry.code === 'RUB')
  const usd = day.currencies.find((entry) => entry.code === 'USD')
  if (!rub || !usd) throw new Error('NBG response is missing RUB or USD')

  return {
    date: day.date,
    rubGel: rub.rate / rub.quantity,
    usdGel: usd.rate / usd.quantity,
  }
}

export async function fetchNbgRates(): Promise<NbgRates> {
  const response = await fetch(NBG_URL)
  if (!response.ok) {
    throw new Error(`NBG request failed with status ${response.status}`)
  }
  const json = (await response.json()) as NbgDayEntry[]
  return parseNbgRates(json)
}
