import type { CollectionAfterLoginHook } from 'payload'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { getEmailSender } from '../../server/notify'

/**
 * ADR 0016 (T5.14): a login is a break-glass login exactly when
 * `x-vercel-ip-country` is *present* and not `GE` — proxy.ts already only
 * let it through because either the country was GE or break-glass applied,
 * so a present, non-GE country here can only mean the latter. The header
 * is absent for every local/Docker/test request and for anything not
 * behind Vercel, which must not be treated as a break-glass login.
 */
export const auditBreakGlassLogin: CollectionAfterLoginHook<User> = async ({ req, user }) => {
  const country = req.headers.get('x-vercel-ip-country')
  if (!country || country === 'GE') return

  // Never store the IP here (ADR 0016) — only Vercel's own Activity Log and
  // proxy.ts's console.warn ever see it, and only transiently.
  await req.payload.create({
    collection: 'audit-events',
    data: {
      type: 'login.break-glass',
      user: user.id,
      country,
      at: new Date().toISOString(),
    },
    overrideAccess: true,
    req,
  })

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
}
