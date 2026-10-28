import type { CollectionConfig } from 'payload'

import { isAdminField } from '../access/isAdminField'
import { ADMIN, isSuperAdmin, isSuperAdminField, SUPER_ADMIN, superAdminNotSelf, superAdminOrSelf } from '../access/isSuperAdmin'
import { resetTotpEndpoint } from '../endpoints/resetTotp'
import { auditLogin } from './hooks/loginAudit'
import { enforcePasswordMinLength } from './hooks/passwordPolicy'
import { requireTotp } from './hooks/requireTotp'
import { reserveTotpAttempt } from './hooks/reserveTotpAttempt'
import { flagPasswordChange, revokeSessionsOnPasswordChange, revokeSessionsOnPasswordReset } from './hooks/revokeOnPasswordChange'
import { clampRefreshExpiry, enforceSessionMaxAge } from './hooks/sessionMaxAge'
import { openEnrollmentOnCreate, preventSelfDemotion } from './hooks/userRoles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role', 'totpEnabledAt'],
  },
  // ADR 0018 addendum C: a Super Admin creates, deletes and resets accounts;
  // an Admin sees and edits (e.g. the password of) only their own account.
  access: {
    create: isSuperAdmin,
    read: superAdminOrSelf,
    update: superAdminOrSelf,
    delete: superAdminNotSelf,
    unlock: isSuperAdmin,
  },
  endpoints: [resetTotpEndpoint],
  // ADR 0014 §4: named accounts only, lockout after 5 failed attempts,
  // secure cookies in production.
  auth: {
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    tokenExpiration: 7200,
    // ADR 0018 addendum A (T5.17a): explicit, even though it's Payload's
    // own default — sessions are what revokeUserSessions/enforceSessionMaxAge
    // below act on (the `users_sessions` child table), so this being true
    // is load-bearing, not incidental.
    useSessions: true,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
  },
  hooks: {
    beforeValidate: [enforcePasswordMinLength, flagPasswordChange],
    beforeChange: [openEnrollmentOnCreate, preventSelfDemotion],
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
    // ADR 0018 addendum A (T5.17a): a password change invalidates every
    // other session for that account (its own current one excepted, on a
    // self change) — flagPasswordChange (beforeValidate above) marks the
    // request via req.context.
    afterChange: [revokeSessionsOnPasswordChange],
    // Code review finding (ADR 0018 addendum A): `resetPassword` (the public
    // forgot-password flow) writes the new password via `payload.db.updateOne`
    // directly, bypassing afterChange above — this covers that path too. See
    // revokeSessionsOnPasswordReset's comment.
    afterOperation: [revokeSessionsOnPasswordReset],
    // reserveTotpAttempt: code review finding on requireTotp's throttle —
    // atomically reserves this login attempt (operation: 'login' only)
    // before any transaction opens on the users row. enforceSessionMaxAge:
    // ADR 0018 addendum A, 12 h absolute session cap, checked on refresh.
    beforeOperation: [reserveTotpAttempt, enforceSessionMaxAge],
    // Code review finding: a refresh late in the 12 h window used to still
    // grant a full tokenExpiration (2 h), so the true max session lifetime
    // was 12 h + that last token's 2 h = 14 h. clampRefreshExpiry shortens
    // the refreshed token to end exactly at createdAt + 12 h instead.
    refresh: [clampRefreshExpiry],
  },
  fields: [
    // Email added by default
    {
      name: 'role',
      type: 'select',
      label: 'როლი',
      // Not `required`, so the generated type doesn't force `role` on every
      // create; the column is nullable, and a null role counts as Admin.
      defaultValue: ADMIN,
      options: [
        { label: 'Super Admin', value: SUPER_ADMIN },
        { label: 'Admin', value: ADMIN },
      ],
      admin: { position: 'sidebar' },
      access: { read: isAdminField, create: isSuperAdminField, update: isSuperAdminField },
    },
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
    // ADR 0018 addendum C: set on create and by "reset 2FA"; cleared once
    // the user scans the first-login QR (requireTotp.ts).
    {
      name: 'enrollmentOpenUntil',
      type: 'date',
      label: 'QR-ის ვადა (პირველი შესვლა)',
      admin: {
        readOnly: true,
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        condition: (data) => !data?.totpEnabledAt,
      },
      access: { read: isAdminField, create: () => false, update: () => false },
    },
    {
      name: 'resetTotpAction',
      type: 'ui',
      label: '2FA-ს განულება',
      admin: {
        position: 'sidebar',
        components: { Field: '/components/admin/ResetTotpButton#ResetTotpButton' },
      },
    },
  ],
}
