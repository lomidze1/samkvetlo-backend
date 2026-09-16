import type { Order } from '../../payload-types'

// ADR 0007 §6: a failed notification never blocks the order, but the owner
// must notice a lost SMS/email. Pure predicate so the warning state is
// testable without rendering (FailedNotificationsWarning.tsx just calls it).
export function hasFailedNotification(notifications: Order['notifications']): boolean {
  return (notifications ?? []).some((entry) => entry.status === 'failed')
}
