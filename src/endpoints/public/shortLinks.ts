import { z } from 'zod'

import { PublicShortLinkSchema } from '../../shared/contract/shortLink'
import { getPublicShortLinks } from '../../server/public/shortLinks'
import { publicEndpoint } from './publicEndpoint'

export const shortLinksEndpoint = publicEndpoint({
  path: '/public/short-links',
  method: 'get',
  scope: 'read',
  output: z.array(PublicShortLinkSchema),
  handler: async (req) => getPublicShortLinks(req.payload),
})
