// ADR 0006: pure pricing formula — no Payload/DB imports, so the ADR's test
// vectors can be checked directly against plain numbers.

export type MarkupIndicator = 'green' | 'red' | 'yellow'

export interface PricingFormulaInput {
  /** Purchase cost in RUB. */
  costRub: number
  /** RUB -> GEL unit rate (ADR 0006: NBG rate / quantity). */
  rubGel: number
  /** Transport cost, Russia -> Tbilisi (D16), already in GEL. */
  logisticsGel: number
  /** Any other GEL cost (customs, packaging, ...). */
  otherCostsGel: number
  /** Card/bank processing fee, percent. */
  bankFeePct: number
  /** Buffer/contingency, percent. */
  bufferPct: number
  /** Markup percent (pricing-settings.pPercent, or a category override). */
  pPercent: number
  /** USD -> GEL unit rate, for the markup floor/ceiling. */
  usdGel: number
  /** Markup floor, in USD. */
  minMarkupUsd: number
  /** Markup ceiling, in USD. */
  maxMarkupUsd: number
  /** Rounding step for the suggested price, in GEL (half-up). */
  roundingStepGel: number
  /** markupSharePct at/under this -> green. */
  thresholdYellowPct: number
  /** markupSharePct at/under this -> yellow; above -> red. */
  thresholdRedPct: number
}

export interface PricingFormulaResult {
  /** costRub × rubGel + logisticsGel + otherCostsGel. */
  base: number
  /** base × (1 + (bankFeePct + bufferPct) / 100). */
  costGel: number
  /** clamp(costGel × pPercent / 100, minMarkupUsd × usdGel, maxMarkupUsd × usdGel). */
  markupGel: number
  /** round₍roundingStepGel₎(costGel + markupGel), half-up. */
  suggestedPriceGel: number
  /** markupGel / costGel × 100. */
  markupSharePct: number
  indicator: MarkupIndicator
}

function roundHalfUpToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function computePricing(input: PricingFormulaInput): PricingFormulaResult {
  const base = input.costRub * input.rubGel + input.logisticsGel + input.otherCostsGel
  const costGel = base * (1 + (input.bankFeePct + input.bufferPct) / 100)

  const markupRaw = costGel * (input.pPercent / 100)
  const minMarkupGel = input.minMarkupUsd * input.usdGel
  const maxMarkupGel = input.maxMarkupUsd * input.usdGel
  const markupGel = Math.min(Math.max(markupRaw, minMarkupGel), maxMarkupGel)

  const suggestedPriceGel = roundHalfUpToStep(costGel + markupGel, input.roundingStepGel)
  const markupSharePct = (markupGel / costGel) * 100

  const indicator: MarkupIndicator =
    markupSharePct <= input.thresholdYellowPct
      ? 'green'
      : markupSharePct <= input.thresholdRedPct
        ? 'yellow'
        : 'red'

  return { base, costGel, markupGel, suggestedPriceGel, markupSharePct, indicator }
}
