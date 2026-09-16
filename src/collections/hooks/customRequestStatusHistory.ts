import type { CollectionBeforeChangeHook } from 'payload'

/**
 * ADR 0011 §3: new -> contacted -> quoted -> won | lost. Same approach as
 * trackOrderStatusHistory (orderStatusHistory.ts) — every change is logged
 * (from/to/by/at) and statusChangedAt moves, which is also the D25
 * retention clock's start point. No transition graph is enforced (ADR
 * 0003 §8's "a human decides" applies here too — ADR 0011 only adds a
 * guard for Order.status, not custom-requests).
 */
export const trackCustomRequestStatusHistory: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

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
