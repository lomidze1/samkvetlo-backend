import type { CollectionBeforeChangeHook } from 'payload'

/**
 * ADR 0003 §8 / ADR 0014 §12: every status change is logged (from/to/by/at)
 * and statusChangedAt moves — that's also the D25 retention clock's start
 * point. `statusChangedAt` defaults to createdAt on the initial create.
 */
export const trackOrderStatusHistory: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  // Anonymization (T5.12, not built yet) will run through the Local API
  // with this context flag — it must not touch statusHistory/statusChangedAt.
  if (req.context?.anonymizing) return data

  if (operation === 'create') {
    return { ...data, statusChangedAt: data.statusChangedAt ?? new Date().toISOString() }
  }

  if (data.status && data.status !== originalDoc?.status) {
    const now = new Date().toISOString()
    return {
      ...data,
      statusChangedAt: now,
      statusHistory: [
        ...(originalDoc?.statusHistory ?? []),
        { from: originalDoc?.status, to: data.status, by: req.user?.id, at: now },
      ],
    }
  }

  return data
}
