import { APIError, type Endpoint, type PayloadRequest } from 'payload'

import { ka } from '../i18n/ka'

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
  return {
    price,
    overrideRed: typeof data.overrideRed === 'boolean' ? data.overrideRed : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
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

    const { price, overrideRed, reason } = parseBody(req)

    const costing = await req.payload.findByID({
      collection: 'costings',
      id: costingId,
      depth: 0,
      overrideAccess: true,
      req,
    })

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

    await req.payload.update({
      collection: 'variants',
      id: variantId,
      data: { price, priceStatus: 'approved' },
      overrideAccess: true,
      req,
    })

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

    return Response.json({ ok: true, price, priceStatus: 'approved' })
  },
}
