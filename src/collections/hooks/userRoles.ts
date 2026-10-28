import type { CollectionBeforeChangeHook } from 'payload'

import type { User } from '../../payload-types'

// ADR 0018 addendum C: a new account (created in the admin by a Super Admin)
// has no TOTP secret; its owner scans a QR on first login within this window.
export const ENROLLMENT_WINDOW_MS = 72 * 60 * 60 * 1000

export function enrollmentDeadline(now: Date = new Date()): string {
  return new Date(now.getTime() + ENROLLMENT_WINDOW_MS).toISOString()
}

export const openEnrollmentOnCreate: CollectionBeforeChangeHook<User> = ({ data, operation }) => {
  if (operation === 'create' && !data.totpSecret && !data.enrollmentOpenUntil) {
    return { ...data, enrollmentOpenUntil: enrollmentDeadline() }
  }
  return data
}
