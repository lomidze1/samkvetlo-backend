import { APIError, type CollectionBeforeChangeHook } from 'payload'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { SUPER_ADMIN } from '../../access/isSuperAdmin'

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

/**
 * Only a Super Admin can change roles (field access), and never their own:
 * with self-delete also blocked (superAdminNotSelf) there is always at
 * least one Super Admin left.
 */
export const preventSelfDemotion: CollectionBeforeChangeHook<User> = ({ data, operation, originalDoc, req }) => {
  if (
    operation === 'update' &&
    req.user &&
    originalDoc &&
    String(originalDoc.id) === String(req.user.id) &&
    originalDoc.role === SUPER_ADMIN &&
    data.role !== undefined &&
    data.role !== SUPER_ADMIN
  ) {
    throw new APIError(ka.server.security.roles.cannotDemoteSelf, 400, null, true)
  }
  return data
}
