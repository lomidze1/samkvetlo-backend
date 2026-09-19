import { createHash, timingSafeEqual } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'

import { runRetention } from '../server/retention/run'

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
 * ADR 0014 §12 (D25), T5.12: root endpoint (same auth pattern as
 * cronRates.ts) — a Vercel Cron job calls this nightly with `Authorization:
 * Bearer ${CRON_SECRET}`. Runs every retention rule (ipHash nulling,
 * expired share-link deletion, order/custom-request anonymization).
 */
export const cronRetentionEndpoint: Endpoint = {
  path: '/cron/retention',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!hasValidCronSecret(req)) {
      return Response.json({ error: { code: 'err.unauthorized' } }, { status: 401 })
    }

    const result = await runRetention(req.payload)
    return Response.json({ ok: true, ...result })
  },
}
