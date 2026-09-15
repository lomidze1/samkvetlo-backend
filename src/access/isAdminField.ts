import type { FieldAccess } from 'payload'

// Same check as isAdmin.ts, typed for field-level access (ADR 0005 §layer 2)
// instead of collection-level access — the two have incompatible generic
// signatures (FieldAccess's `id` may be string | number; Access's is not).
export const isAdminField: FieldAccess = ({ req }) => Boolean(req.user)
