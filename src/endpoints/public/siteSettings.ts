import { PublicSiteSettingsSchema } from '../../shared/contract/siteSettings'
import { getPublicSiteSettings } from '../../server/public/siteSettings'
import { publicEndpoint } from './publicEndpoint'

export const siteSettingsEndpoint = publicEndpoint({
  path: '/public/site-settings',
  method: 'get',
  scope: 'read',
  output: PublicSiteSettingsSchema,
  handler: async (req) => getPublicSiteSettings(req.payload),
})
