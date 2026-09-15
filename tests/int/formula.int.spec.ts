import { describe, expect, it } from 'vitest'

import { computePricing, type PricingFormulaInput } from '@/lib/pricing/formula'

// ADR 0006: test vectors. usdGel = 2.6095, P = 30, step = 10, fee = buffer = 0
// (so costGel === the given C directly, since base === C).
const BASE_INPUT: Omit<PricingFormulaInput, 'costRub' | 'rubGel' | 'logisticsGel' | 'otherCostsGel'> = {
  bankFeePct: 0,
  bufferPct: 0,
  pPercent: 30,
  usdGel: 2.6095,
  minMarkupUsd: 1000,
  maxMarkupUsd: 2500,
  roundingStepGel: 10,
  thresholdYellowPct: 100,
  thresholdRedPct: 150,
}

// costRub/rubGel/logisticsGel/otherCostsGel chosen so base === C directly
// (costRub × rubGel = C, rest 0) — matches how the ADR table is written.
function withC(costGel: number): PricingFormulaInput {
  return { ...BASE_INPUT, costRub: costGel, rubGel: 1, logisticsGel: 0, otherCostsGel: 0 }
}

describe('computePricing (T1.4, ADR 0006 test vectors)', () => {
  it.each([
    [1_000, 3_610, 261, 'red'],
    [2_000, 4_610, 130, 'yellow'],
    [5_000, 7_610, 52, 'green'],
    [12_000, 15_600, 30, 'green'],
    [40_000, 46_520, 16, 'green'],
  ] as const)('C = %d -> suggested %d, share ~%d%%, %s', (costGel, suggested, sharePct, indicator) => {
    const result = computePricing(withC(costGel))
    expect(result.suggestedPriceGel).toBe(suggested)
    expect(Math.round(result.markupSharePct)).toBe(sharePct)
    expect(result.indicator).toBe(indicator)
  })

  it('C vector: costRub 135000, rubGel 0.030923, logistics 400, fee 1%, buffer 5%', () => {
    const result = computePricing({
      ...BASE_INPUT,
      costRub: 135_000,
      rubGel: 0.030923,
      logisticsGel: 400,
      otherCostsGel: 0,
      bankFeePct: 1,
      bufferPct: 5,
    })
    expect(result.base).toBeCloseTo(4_574.605, 3)
    expect(result.costGel).toBeCloseTo(4_849.08, 2)
    expect(result.markupGel).toBeCloseTo(2_609.5, 1)
    expect(result.suggestedPriceGel).toBe(7_460)
    expect(result.markupSharePct).toBeCloseTo(53.8, 1)
    expect(result.indicator).toBe('green')
  })
})
