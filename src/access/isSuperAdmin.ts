import type { Access, FieldAccess } from 'payload'

// ADR 0018 addendum C: two roles. Every logged-in user is an admin for
// catalog/pricing/orders (isAdmin.ts); only a Super Admin manages accounts.

type RoleCarrier = { role?: string | null } | null | undefined

export const SUPER_ADMIN = 'super-admin'
export const ADMIN = 'admin'

export function hasSuperAdminRole(user: RoleCarrier): boolean {
  return user?.role === SUPER_ADMIN
}

export const isSuperAdmin: Access = ({ req }) => hasSuperAdminRole(req.user)

export const isSuperAdminField: FieldAccess = ({ req }) => hasSuperAdminRole(req.user)

/** Super Admin: every account. Admin: only their own. */
export const superAdminOrSelf: Access = ({ req }) => {
  if (!req.user) return false
  if (hasSuperAdminRole(req.user)) return true
  return { id: { equals: req.user.id } }
}

/**
 * Super Admin only, and never their own account (no self-lockout). Bulk
 * delete calls this without an `id`, so that case is a where-constraint.
 */
export const superAdminNotSelf: Access = ({ id, req }) => {
  if (!req.user || !hasSuperAdminRole(req.user)) return false
  if (id === undefined) return { id: { not_equals: req.user.id } }
  return String(id) !== String(req.user.id)
}
