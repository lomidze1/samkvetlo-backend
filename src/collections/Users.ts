import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { auditBreakGlassLogin } from './hooks/breakGlassAudit'
import { enforcePasswordMinLength } from './hooks/passwordPolicy'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  // ADR 0014 §4: named accounts only, lockout after 5 failed attempts,
  // secure cookies in production.
  auth: {
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    tokenExpiration: 7200,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
  },
  hooks: {
    beforeValidate: [enforcePasswordMinLength],
    // ADR 0016 (T5.14): logs + emails the owners on a break-glass login.
    afterLogin: [auditBreakGlassLogin],
  },
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
