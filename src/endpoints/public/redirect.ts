import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { REDIRECT_TYPE_VALUES, RedirectResultSchema } from '../../shared/contract/redirect'
import { resolvePublicRedirect } from '../../server/public/redirect'
import { publicEndpoint, PublicBadRequestError, PublicNotFoundError } from './publicEndpoint'

// Code review finding M2: the frontend (samkvetlo/src/lib/api/redirect.ts)
// only ever treats a 404 as "no redirect" — anything else (400 included)
// re-throws and 500s the page. `type` is always one of the two literals the
// frontend's own code sends, so a malformed `type` is a genuine client
// error (400). `path`, however, comes from whatever slug the URL router
// extracted — an over-length or otherwise invalid value is exactly the
// same "nothing to redirect to" case as a value that parses fine but
// matches no document, so it 404s too, not 400s. Validated as two
// separate primitive schemas (not a combined object) precisely so each can
// fail into a different response.
const TypeSchema = z.enum(REDIRECT_TYPE_VALUES)
const PathSchema = z.string().min(1).max(200)

export const redirectEndpoint = publicEndpoint({
  path: '/public/redirect',
  method: 'get',
  scope: 'read',
  output: RedirectResultSchema,
  handler: async (req: PayloadRequest) => {
    const url = new URL(req.url ?? '', 'http://localhost')

    const typeResult = TypeSchema.safeParse(url.searchParams.get('type'))
    if (!typeResult.success) throw new PublicBadRequestError()

    const pathResult = PathSchema.safeParse(url.searchParams.get('path'))
    if (!pathResult.success) throw new PublicNotFoundError()

    const to = await resolvePublicRedirect(req.payload, typeResult.data, pathResult.data)
    if (!to) throw new PublicNotFoundError()

    return { to }
  },
})
