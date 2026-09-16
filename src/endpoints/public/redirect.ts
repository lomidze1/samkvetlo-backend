import type { PayloadRequest } from 'payload'

import { RedirectResultSchema } from '../../shared/contract/redirect'
import { resolvePublicRedirect } from '../../server/public/redirect'
import { publicEndpoint, PublicNotFoundError } from './publicEndpoint'

const REDIRECT_TYPES = new Set(['product', 'category'])

export const redirectEndpoint = publicEndpoint({
  path: '/public/redirect',
  method: 'get',
  scope: 'read',
  output: RedirectResultSchema,
  handler: async (req: PayloadRequest) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const type = url.searchParams.get('type')
    const path = url.searchParams.get('path')

    if (!type || !REDIRECT_TYPES.has(type) || !path) {
      throw new PublicNotFoundError()
    }

    const to = await resolvePublicRedirect(req.payload, type as 'product' | 'category', path)
    if (!to) throw new PublicNotFoundError()

    return { to }
  },
})
