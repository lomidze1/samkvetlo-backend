import type { Payload } from 'payload'

import type { CustomRequest, Order } from '../../payload-types'

// ADR 0014 §12 (D25) / T5.12: an order with an open financial obligation is
// never auto-anonymized — the cron's digest email lists it for the owner
// instead, and the general rule applies once they close it.
export const ORDER_ANONYMIZE_EXEMPT_STATUSES = ['paid', 'ordered-from-supplier', 'in-transit'] as const

function idOf(value: number | { id: number }): number {
  return typeof value === 'number' ? value : value.id
}

/**
 * Blanks the client PII on one order and stamps `anonymizedAt`. Everything
 * else — number, items[] (snapshot), totals, deliveryZone, status,
 * statusHistory, payment, patriarchateLetter files — is untouched: this
 * function's `data` only ever names the PII fields.
 *
 * `context.anonymizing: true` is required — Orders' beforeChange hooks
 * (computeOrderTotals, trackOrderStatusHistory) key off it to skip their
 * usual recompute, which would otherwise wipe items[]/totals (this update
 * never sends `items`) or add a phantom statusHistory entry.
 *
 * Used identically by the retention cron (src/server/retention/run.ts) and
 * the admin "anonymize" button (src/endpoints/anonymize.ts) — one
 * function, one behavior, regardless of caller.
 */
export async function anonymizeOrder(payload: Payload, order: Order): Promise<void> {
  await payload.update({
    collection: 'orders',
    id: order.id,
    data: {
      name: '—',
      surname: '—',
      phone: '—',
      church: '—',
      email: null,
      comment: null,
      anonymizedAt: new Date().toISOString(),
    },
    overrideAccess: true,
    context: { anonymizing: true },
  })
}

/**
 * Same idea as anonymizeOrder, plus deleting the request's attachments
 * (private-files docs — deleting the Payload doc also removes the
 * underlying stored file). No status is exempt for custom-requests (no
 * financial obligation, per ADR 0014 §12's table).
 */
export async function anonymizeCustomRequest(payload: Payload, request: CustomRequest): Promise<void> {
  for (const attachment of request.attachments ?? []) {
    try {
      await payload.delete({ collection: 'private-files', id: idOf(attachment), overrideAccess: true })
    } catch (error) {
      payload.logger.error(error, 'anonymizeCustomRequest: failed to delete an attachment')
    }
  }

  await payload.update({
    collection: 'custom-requests',
    id: request.id,
    data: {
      name: '—',
      surname: '—',
      phone: '—',
      church: '—',
      email: null,
      description: '—',
      attachments: [],
      anonymizedAt: new Date().toISOString(),
    },
    overrideAccess: true,
    context: { anonymizing: true },
  })
}
