import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { REDIRECT_TYPE_VALUES, RedirectResultSchema } from '../../shared/contract/redirect'
import { resolvePublicRedirect } from '../../server/public/redirect'
import { publicEndpoint, PublicBadRequestError, PublicNotFoundError } from './publicEndpoint'

// Code review finding: hand-checked query params let `path` through
// unbounded (a multi-MB value would run its two indexed lookups on every
// request) and returned 404 rather than 400 for a malformed `type`. zod
// makes both the shape and the size limit explicit, and a parse failure is
// a client error (400), not "no such resource" (404).
const QuerySchema = z.strictObject({
  type: z.enum(REDIRECT_TYPE_VALUES),
  path: z.string().min(1).max(200),
})

export const redirectEndpoint = publicEndpoint({
  path: '/public/redirect',
  method: 'get',
  scope: 'read',
  output: RedirectResultSchema,
  handler: async (req: PayloadRequest) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const parsed = QuerySchema.safeParse({
      type: url.searchParams.get('type'),
      path: url.searchParams.get('path'),
    })
    if (!parsed.success) throw new PublicBadRequestError()

    const { type, path } = parsed.data
    const to = await resolvePublicRedirect(req.payload, type, path)
    if (!to) throw new PublicNotFoundError()

    return { to }
  },
})
