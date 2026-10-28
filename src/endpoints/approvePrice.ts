import {
  addDataAndFileToRequest,
  APIError,
  commitTransaction,
  type Endpoint,
  initTransaction,
  killTransaction,
  type PayloadRequest,
} from 'payload'

import { ka } from '../i18n/ka'
import { notifyRevalidate } from '../server/revalidate/notify'
import { withRevalidateSkipped } from '../server/revalidate/withRevalidateSkipped'

interface ApproveBody {
  overrideRed?: boolean
  price: number
  reason?: string
}

function parseBody(req: PayloadRequest): ApproveBody {
  const data = req.data ?? {}
  const price = data.price
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new APIError(ka.server.pricing.priceRequired, 400)
  }
  const reason = typeof data.reason === 'string' ? data.reason.trim() : undefined
  return {
    price,
    overrideRed: typeof data.overrideRed === 'boolean' ? data.overrideRed : undefined,
    reason: reason && reason.length > 0 ? reason : undefined,
  }
}

// ADR 0006 (approval workflow): the only place variant.price/priceStatus
// change. Admin-only; a red indicator additionally needs overrideRed +
// reason (ADR 0009 §6).
export const approvePriceEndpoint: Endpoint = {
  path: '/:id/approve',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!req.user) {
      return Response.json({ error: { code: 'err.forbidden' } }, { status: 403 })
    }

    const costingId = req.routeParams?.id
    if (typeof costingId !== 'string' && typeof costingId !== 'number') {
      return Response.json({ error: { code: 'err.notFound' } }, { status: 404 })
    }

    // Payload's REST dispatcher (handleEndpoints) does not parse the request
    // body for custom endpoints — only built-in collection operations do
    // that. Without this, req.data stays empty for every real HTTP call.
    if (!req.data) {
      await addDataAndFileToRequest(req)
    }

    const { price, overrideRed, reason } = parseBody(req)

    // Both updates below must land together (code review finding on
    // T1.1–T1.8): a costing-write failure must not leave the variant price
    // changed. Every payload.* call below carries `req`, so the Postgres
    // adapter runs them against this same transaction.
    const shouldCommit = await initTransaction(req)
    try {
      const costing = await req.payload.findByID({
        collection: 'costings',
        id: costingId,
        depth: 0,
        overrideAccess: true,
        req,
      })

      if (typeof costing.costRub !== 'number') {
        throw new APIError(ka.server.pricing.costRequired, 400)
      }
      if (costing.indicator === 'red' && !overrideRed) {
        throw new APIError(ka.server.pricing.redNeedsOverride, 400)
      }
      if (overrideRed && !reason) {
        throw new APIError(ka.server.pricing.redNeedsReason, 400)
      }

      const variantId = costing.variant as number | string
      const variant = await req.payload.findByID({
        collection: 'variants',
        id: variantId,
        depth: 0,
        overrideAccess: true,
        req,
      })

      // Code review fix: this used to revalidate through Variants' own
      // afterChange hook, which fired *before* the transaction below
      // commits — a reader could be served a page revalidated with data
      // that then rolls back. Silenced here; notifyRevalidate is called
      // explicitly after commitTransaction instead.
      await withRevalidateSkipped(req, () =>
        req.payload.update({
          collection: 'variants',
          id: variantId,
          data: { price, priceStatus: 'approved' },
          overrideAccess: true,
          req,
        }),
      )

      const now = new Date().toISOString()
      await req.payload.update({
        collection: 'costings',
        id: costingId,
        data: {
          proposedPriceGel: price,
          approvedBy: req.user.id,
          approvedAt: now,
          priceHistory: [
            ...(costing.priceHistory ?? []),
            {
              from: typeof variant.price === 'number' ? variant.price : null,
              to: price,
              by: req.user.id,
              at: now,
              reason,
              rateDate: costing.rateDate,
              auto: false,
            },
          ],
        },
        overrideAccess: true,
        req,
      })

      if (shouldCommit) await commitTransaction(req)
      await notifyRevalidate(req.payload, ['catalog'], req.context)
      return Response.json({ ok: true, price, priceStatus: 'approved' })
    } catch (error) {
      await killTransaction(req)
      throw error
    }
  },
}
