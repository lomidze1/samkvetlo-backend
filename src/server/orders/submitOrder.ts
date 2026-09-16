import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import type { OrderInput, OrderResult } from '../../shared/contract/order'
import { PublicHttpError } from '../../endpoints/public/publicEndpoint'
import { isRateLimited } from '../security/rateLimit'
import { verifyTurnstile } from '../security/turnstile'
import { getActiveDeliveryZoneBySlug } from '../public/deliveryZones'
import { notifyOrderCreated } from './notifyOrder'
import { repriceCartLines } from './repriceLines'

export interface SubmitOrderContext {
  ipHash: string
  clientIp: string
}

type ExistingOrder = Pick<Order, 'number' | 'deliveryZone'>

function toOrderResult(order: ExistingOrder, fallbackZoneSlug: string): OrderResult {
  return { number: order.number ?? '', deliveryZone: order.deliveryZone?.slug ?? fallbackZoneSlug }
}

async function findBySubmissionId(payload: Payload, submissionId: string): Promise<ExistingOrder | null> {
  const { docs } = await payload.find({
    collection: 'orders',
    where: { submissionId: { equals: submissionId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

/**
 * T3.3 (ADR 0003 §4 + its 2026-09-14/15 step-order update, ADR 0015 §3-4).
 * Step order: idempotency -> Turnstile -> rate limit -> reprice -> zone ->
 * create -> notify. Every non-2xx outcome after the zod input schema is a
 * thrown PublicHttpError, caught by publicEndpoint.
 */
export async function submitOrder(payload: Payload, input: OrderInput, ctx: SubmitOrderContext): Promise<OrderResult> {
  // Idempotency: a repeated submissionId returns the same number without
  // touching Turnstile again (a token is single-use).
  const existing = await findBySubmissionId(payload, input.submissionId)
  if (existing) return toOrderResult(existing, input.deliveryZone)

  const verified = await verifyTurnstile({
    token: input.turnstileToken,
    remoteIp: ctx.clientIp,
    idempotencyKey: input.submissionId,
  })
  if (!verified) throw new PublicHttpError(403, 'err.turnstile')

  const limited = await isRateLimited(payload, {
    collection: 'orders',
    ipHash: ctx.ipHash,
    windowMs: 10 * 60 * 1000,
    max: 5,
  })
  if (limited) throw new PublicHttpError(429, 'err.rateLimited')

  // A price difference alone is not an error (ADR 0003 §4.4 — the server
  // freezes its own price); err.cart.changed only fires when a line is no
  // longer publicly purchasable at all.
  const repriced = await repriceCartLines(payload, input.lines)
  if (repriced.some((line) => !line.available)) throw new PublicHttpError(409, 'err.cart.changed')

  const zone = await getActiveDeliveryZoneBySlug(payload, input.deliveryZone)
  if (!zone) throw new PublicHttpError(400, 'err.deliveryZone.invalid')

  const items = repriced.map((line) => ({
    variant: line.variantId,
    productTitle: line.productTitle ?? '',
    variantTitle: line.variantTitle ?? '',
    sku: line.sku ?? '',
    unitPrice: line.unitPrice ?? 0,
    qty: line.qty,
  }))

  const orderData = {
    submissionId: input.submissionId,
    name: input.name,
    surname: input.surname,
    phone: input.phone,
    church: input.church,
    city: input.city,
    email: input.email,
    comment: input.comment,
    items,
    deliveryZone: { slug: zone.slug, name: zone.name },
    deliveryFeeGel: zone.feeGel,
    status: 'new' as const,
    ipHash: ctx.ipHash,
  }

  let order: Order
  try {
    order = await payload.create({ collection: 'orders', data: orderData, overrideAccess: true })
  } catch (err) {
    // A concurrent double-submit can race past the check above — the DB's
    // unique constraint on submissionId is the real guard (ADR 0003 §5).
    const raced = await findBySubmissionId(payload, input.submissionId)
    if (raced) return toOrderResult(raced, zone.slug)
    throw err
  }

  await notifyOrderCreated(payload, order)

  return { number: order.number ?? '', deliveryZone: zone.slug }
}
