import { PublicSitemapSchema } from '../../shared/contract/sitemap'
import { getPublicSitemap } from '../../server/public/sitemap'
import { publicEndpoint } from './publicEndpoint'

export const sitemapEndpoint = publicEndpoint({
  path: '/public/sitemap',
  method: 'get',
  scope: 'read',
  output: PublicSitemapSchema,
  handler: async (req) => getPublicSitemap(req.payload),
})
