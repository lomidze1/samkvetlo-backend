import type { Payload } from 'payload'

import type { CustomRequest, Order } from '../../payload-types'

type NotificationEntry = NonNullable<Order['notifications']>[number]

// Code review finding: sendAndReport.ts writes the raw provider error
// message into notifications[].error (admin-only), and a real bounce
// routinely echoes the recipient back (e.g. "Invalid to field:
// x@y.ge") — so anonymization must blank it too, not just the top-level
// name/phone/email fields.
function withErrorsBlanked(
  notifications: CustomRequest['notifications'] | Order['notifications'],
): NotificationEntry[] | undefined {
  if (!notifications) return undefined
  return notifications.map((entry) => (entry.error ? { ...entry, error: null } : entry))
}

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
      notifications: withErrorsBlanked(order.notifications),
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
export async function anonymizeCustomRequest(payload: Payload, request: CustomRequest): Promise<{ anonymized: boolean }> {
  // Code review finding: a storage failure on delete was swallowed and
  // `attachments: []` written anyway, losing the reference to a file that
  // was never actually deleted. Failed ids are kept in `attachments` and
  // `anonymizedAt` is left unset instead, so the next cron run retries
  // exactly those attachments — re-blanking the already-"—" PII fields in
  // the meantime is harmless.
  const remainingAttachments: NonNullable<CustomRequest['attachments']> = []
  let hadFailure = false
  for (const attachment of request.attachments ?? []) {
    try {
      await payload.delete({ collection: 'private-files', id: idOf(attachment), overrideAccess: true })
    } catch (error) {
      payload.logger.error(error, 'anonymizeCustomRequest: failed to delete an attachment — will retry next run')
      hadFailure = true
      remainingAttachments.push(attachment)
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
      attachments: remainingAttachments,
      notifications: withErrorsBlanked(request.notifications),
      anonymizedAt: hadFailure ? null : new Date().toISOString(),
    },
    overrideAccess: true,
    context: { anonymizing: true },
  })

  return { anonymized: !hadFailure }
}
