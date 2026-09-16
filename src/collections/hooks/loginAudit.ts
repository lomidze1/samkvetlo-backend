import type { CollectionAfterLoginHook } from 'payload'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { getEmailSender } from '../../server/notify'

/**
 * ADR 0014 §4 fallback (TOTP spike failed — T5.9/docs/spikes/totp-spike.md
 * — 2FA is deferred past launch): geo + lockout + long passwords have one
 * blind spot — a stolen password used from *inside* Georgia produces zero
 * signal. So every successful login is audited, not just break-glass ones:
 * `login.success` (silent) or `login.break-glass` (also emails the owners,
 * ADR 0016/T5.14 — proxy.ts only let a non-GE request through because
 * break-glass applied).
 *
 * `country` is stored exactly as the header arrived — '' when it's absent
 * (local/Docker/tests, or anything not behind Vercel), never the IP.
 *
 * Best-effort: an audit-write or email failure must never block a login
 * that has already succeeded, so the whole body is one try/catch logging
 * through `req.payload.logger`.
 */
export const auditLogin: CollectionAfterLoginHook<User> = async ({ req, user }) => {
  try {
    const country = req.headers.get('x-vercel-ip-country') ?? ''
    const type = country && country !== 'GE' ? 'login.break-glass' : 'login.success'

    // Never store the IP here (ADR 0016) — only Vercel's own Activity Log
    // and proxy.ts's console.warn ever see it, and only transiently.
    await req.payload.create({
      collection: 'audit-events',
      data: {
        type,
        user: user.id,
        country,
        at: new Date().toISOString(),
      },
      overrideAccess: true,
      req,
    })

    if (type !== 'login.break-glass') return

    const siteSettings = await req.payload.findGlobal({
      slug: 'site-settings',
      overrideAccess: true,
      req,
    })
    const ownerEmails = (siteSettings.ownerEmails ?? [])
      .map((entry) => entry.email)
      .filter((email): email is string => Boolean(email))

    if (ownerEmails.length > 0) {
      await getEmailSender().send({
        to: ownerEmails,
        subject: ka.server.security.breakGlassSubject(user.email),
        text: ka.server.security.breakGlassBody(user.email, country),
      })
    }
  } catch (error) {
    req.payload.logger.error(error, 'auditLogin failed')
  }
}
