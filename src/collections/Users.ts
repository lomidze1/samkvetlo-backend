import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'
import { auditLogin } from './hooks/loginAudit'
import { enforcePasswordMinLength } from './hooks/passwordPolicy'
import { requireTotp } from './hooks/requireTotp'

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
    // ADR 0018 (T5.17): 2FA gate — closes the T5.9 spike's hole (a user
    // with no TOTP secret used to reach admin-only data with just the
    // password). Runs before jwtSign, in the same request/transaction as
    // the password; also covers resetPassword and registerFirstUser,
    // which call the same login operation.
    beforeLogin: [requireTotp],
    // Audits every successful login, not just break-glass ones (a stolen
    // password used from inside Georgia is otherwise silent). Emails the
    // owners only on break-glass (ADR 0016).
    afterLogin: [auditLogin],
  },
  fields: [
    // Email added by default
    // ADR 0018 §1: never exposed over the API (login response, GET
    // /api/users/:id, /me, JWT payload) or the admin UI — written only by
    // the CLI (scripts/admin-totp.ts) and requireTotp.ts, both via Local
    // API + overrideAccess: true.
    {
      name: 'totpSecret',
      type: 'text',
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false },
    },
    {
      name: 'totpLastStep',
      type: 'number',
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false },
    },
    // Code review finding (ADR 0018 §2): the login throttle used to count
    // recent `login.totp-failed` audit-events rows — a fire-and-forget,
    // separate-transaction write (see requireTotp.ts's deadlock note),
    // so two concurrent requests could each read the count before either
    // insert lands and both slip past the 5-attempt limit. These two
    // fields make the counter atomic: requireTotp.ts updates them with
    // `req` (the login's own already-open transaction), so concurrent
    // login attempts for the same user serialize on the same row lock
    // addSessionToUser/resetLoginAttempts already hold, instead of racing.
    {
      name: 'totpFailCount',
      type: 'number',
      defaultValue: 0,
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false },
    },
    {
      name: 'totpFailWindowStart',
      type: 'date',
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false },
    },
    {
      name: 'totpEnabledAt',
      type: 'date',
      label: '2FA ჩართულია',
      admin: { readOnly: true, position: 'sidebar' },
      access: { read: isAdminField, create: () => false, update: () => false },
    },
  ],
}
