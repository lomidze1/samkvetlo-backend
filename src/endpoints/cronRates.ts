import { createHash, timingSafeEqual } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'

import { fetchNbgRates } from '../server/rates/nbg'
import { recomputeCostingsForNewRate } from '../server/rates/recompute'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function hasValidCronSecret(req: PayloadRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return false
  const token = header.slice('Bearer '.length)
  return timingSafeEqual(sha256(token), sha256(secret))
}

/**
 * ADR 0006 (rate refresh): root endpoint (not under /api/public/*,
 * which is service-token auth for the storefront) — a Vercel Cron job (or
 * `pnpm rates:sync` locally) calls this daily with `Authorization: Bearer
 * ${CRON_SECRET}`. Fetches the NBG rate, upserts it by date, and
 * recomputes every costing against it.
 */
export const cronRatesEndpoint: Endpoint = {
  path: '/cron/exchange-rates',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!hasValidCronSecret(req)) {
      return Response.json({ error: { code: 'err.unauthorized' } }, { status: 401 })
    }

    const rates = await fetchNbgRates()
    const isoDate = new Date(rates.date).toISOString()

    const { docs: existing } = await req.payload.find({
      collection: 'exchange-rates',
      where: { date: { equals: isoDate } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing[0]) {
      await req.payload.update({
        collection: 'exchange-rates',
        id: existing[0].id,
        data: { rubGel: rates.rubGel, usdGel: rates.usdGel, source: 'nbg', fetchedAt: new Date().toISOString() },
        overrideAccess: true,
      })
    } else {
      await req.payload.create({
        collection: 'exchange-rates',
        data: {
          date: isoDate,
          rubGel: rates.rubGel,
          usdGel: rates.usdGel,
          source: 'nbg',
          fetchedAt: new Date().toISOString(),
        },
        overrideAccess: true,
      })
    }

    const result = await recomputeCostingsForNewRate(req.payload)
    return Response.json({ ok: true, ...result })
  },
}
