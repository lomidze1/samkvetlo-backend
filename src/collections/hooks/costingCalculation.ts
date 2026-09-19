import { APIError, type CollectionBeforeChangeHook } from 'payload'

import { computePricing } from '../../lib/pricing/formula'

function idOf(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return undefined
}

/**
 * ADR 0006: recomputes every derived Costing field (C, markup, suggested
 * price, share%, indicator) from the latest exchange rate and
 * pricing-settings, whenever a costing is saved. `proposedPriceGel`
 * defaults to the suggested price but the owner may have already edited it.
 */
export const computeCostingFields: CollectionBeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data) return data

  const settings = await req.payload.findGlobal({ slug: 'pricing-settings', req })
  const { docs: rates } = await req.payload.find({
    collection: 'exchange-rates',
    sort: '-date',
    limit: 1,
    req,
  })
  const latestRate = rates[0]
  if (!latestRate) {
    throw new APIError('გაცვლითი კურსი არ არსებობს. ჯერ გაუშვით pnpm rates:sync', 400)
  }

  let pUsed = settings.pPercent
  const variantId = idOf(data.variant) ?? idOf(originalDoc?.variant)
  if (variantId !== undefined && settings.categoryOverrides && settings.categoryOverrides.length > 0) {
    const variant = await req.payload.findByID({
      collection: 'variants',
      id: variantId,
      depth: 0,
      req,
    })
    const productId = idOf(variant.product)
    if (productId !== undefined) {
      const product = await req.payload.findByID({
        collection: 'products',
        id: productId,
        depth: 0,
        req,
      })
      const override = settings.categoryOverrides.find(
        (entry) => idOf(entry.category) === idOf(product.category),
      )
      if (override) pUsed = override.pPercent
    }
  }

  const costRub = data.costRub ?? originalDoc?.costRub ?? 0
  const logisticsGel = data.logisticsGel ?? originalDoc?.logisticsGel ?? 0
  const otherCostsGel = data.otherCostsGel ?? originalDoc?.otherCostsGel ?? 0
  const bankFeePct = data.bankFeePct ?? originalDoc?.bankFeePct ?? settings.defaultBankFeePct
  const bufferPct = data.bufferPct ?? originalDoc?.bufferPct ?? settings.defaultBufferPct

  const result = computePricing({
    costRub,
    rubGel: latestRate.rubGel,
    logisticsGel,
    otherCostsGel,
    bankFeePct,
    bufferPct,
    pPercent: pUsed,
    usdGel: latestRate.usdGel,
    minMarkupGel: settings.minMarkupGel,
    maxMarkupUsd: settings.maxMarkupUsd,
    roundingStepGel: settings.roundingStepGel,
    thresholdYellowPct: settings.thresholdYellowPct,
    thresholdRedPct: settings.thresholdRedPct,
  })

  return {
    ...data,
    rateDate: latestRate.date,
    rubGel: latestRate.rubGel,
    usdGel: latestRate.usdGel,
    pUsed,
    costGel: result.costGel,
    markupGel: result.markupGel,
    suggestedPriceGel: result.suggestedPriceGel,
    markupSharePct: result.markupSharePct,
    indicator: result.indicator,
    proposedPriceGel: data.proposedPriceGel ?? originalDoc?.proposedPriceGel ?? result.suggestedPriceGel,
  }
}
