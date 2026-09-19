import { APIError, type Endpoint, type PayloadRequest } from 'payload'

import { ka } from '../i18n/ka'
import { anonymizeCustomRequest, anonymizeOrder } from '../server/retention/anonymize'

/**
 * ADR 0014 §12 (D25) / T5.12: the admin "anonymize" button — manual,
 * data-subject-request path calling the exact same anonymizeOrder /
 * anonymizeCustomRequest the retention cron uses (one behavior, two
 * callers). Registered per-collection (Orders, CustomRequests) since each
 * calls a different anonymize function; `collection` here is only ever one
 * of those two, both admin-only with `create: () => false`, so a plain
 * `req.user` check is the right bar (same as approvePrice.ts).
 */
export function createAnonymizeEndpoint(collection: 'orders' | 'custom-requests'): Endpoint {
  return {
    path: '/:id/anonymize',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      if (!req.user) {
        return Response.json({ error: { code: 'err.forbidden' } }, { status: 403 })
      }

      const id = req.routeParams?.id
      if (typeof id !== 'string' && typeof id !== 'number') {
        return Response.json({ error: { code: 'err.notFound' } }, { status: 404 })
      }

      if (collection === 'orders') {
        const order = await req.payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true })
        if (order.anonymizedAt) throw new APIError(ka.server.retention.alreadyAnonymized, 400)
        await anonymizeOrder(req.payload, order)
      } else {
        const request = await req.payload.findByID({ collection: 'custom-requests', id, depth: 0, overrideAccess: true })
        if (request.anonymizedAt) throw new APIError(ka.server.retention.alreadyAnonymized, 400)
        await anonymizeCustomRequest(req.payload, request)
      }

      return Response.json({ ok: true })
    },
  }
}
