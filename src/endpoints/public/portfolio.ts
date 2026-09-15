import { z } from 'zod'

import { PublicPortfolioItemSchema } from '../../shared/contract/portfolio'
import { getPublicPortfolio, getPublicPortfolioBySlug } from '../../server/public/portfolio'
import { publicEndpoint, PublicNotFoundError } from './publicEndpoint'

export const portfolioListEndpoint = publicEndpoint({
  path: '/public/portfolio',
  method: 'get',
  scope: 'read',
  output: z.array(PublicPortfolioItemSchema),
  handler: async (req) => getPublicPortfolio(req.payload),
})

export const portfolioBySlugEndpoint = publicEndpoint({
  path: '/public/portfolio/:slug',
  method: 'get',
  scope: 'read',
  output: PublicPortfolioItemSchema,
  handler: async (req) => {
    const slug = req.routeParams?.slug
    if (typeof slug !== 'string') throw new PublicNotFoundError()
    const item = await getPublicPortfolioBySlug(req.payload, slug)
    if (!item) throw new PublicNotFoundError()
    return item
  },
})
