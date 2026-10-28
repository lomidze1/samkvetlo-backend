import type { Endpoint, PayloadRequest } from 'payload'

import { hasSuperAdminRole } from '../access/isSuperAdmin'
import { enrollmentDeadline } from '../collections/hooks/userRoles'
import { revokeUserSessions } from '../server/security/sessions'

// ADR 0018 addendum C: Super Admin "reset 2FA" (lost phone, or an unused
// first-login window). Clears the secret, reopens the 72 h QR window and
// signs the account out everywhere. Never on one's own account — a Super
// Admin who loses their phone uses scripts/admin-totp.ts.
export const resetTotpEndpoint: Endpoint = {
  path: '/:id/reset-totp',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!hasSuperAdminRole(req.user)) {
      return Response.json({ error: { code: 'err.forbidden' } }, { status: 403 })
    }

    const userId = req.routeParams?.id
    if (typeof userId !== 'string' && typeof userId !== 'number') {
      return Response.json({ error: { code: 'err.notFound' } }, { status: 404 })
    }
    if (String(userId) === String(req.user?.id)) {
      return Response.json({ error: { code: 'err.forbidden' } }, { status: 403 })
    }

    const { docs } = await req.payload.find({
      collection: 'users',
      where: { id: { equals: userId } },
      limit: 1,
      overrideAccess: true,
    })
    if (!docs[0]) {
      return Response.json({ error: { code: 'err.notFound' } }, { status: 404 })
    }

    await req.payload.update({
      collection: 'users',
      id: userId,
      data: {
        totpSecret: null,
        totpLastStep: null,
        totpEnabledAt: null,
        totpFailCount: 0,
        totpFailWindowStart: null,
        enrollmentOpenUntil: enrollmentDeadline(),
      },
      overrideAccess: true,
    })
    await revokeUserSessions({ payload: req.payload, userId })
    req.payload.logger.info({ userId, by: req.user?.id }, 'resetTotp: 2FA reset')

    return Response.json({ ok: true })
  },
}
