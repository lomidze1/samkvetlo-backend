import { PublicPageSchema } from '../../shared/contract/page'
import { getPublicPageBySlug } from '../../server/public/page'
import { publicEndpoint, PublicNotFoundError } from './publicEndpoint'

export const pageBySlugEndpoint = publicEndpoint({
  path: '/public/pages/:slug',
  method: 'get',
  scope: 'read',
  output: PublicPageSchema,
  handler: async (req) => {
    const slug = req.routeParams?.slug
    if (typeof slug !== 'string') throw new PublicNotFoundError()
    const page = await getPublicPageBySlug(req.payload, slug)
    if (!page) throw new PublicNotFoundError()
    return page
  },
})
