import { z } from 'zod'

import { PublicCategorySchema } from '../../shared/contract/category'
import { getPublicCategories } from '../../server/public/category'
import { publicEndpoint } from './publicEndpoint'

export const categoriesEndpoint = publicEndpoint({
  path: '/public/categories',
  method: 'get',
  scope: 'read',
  output: z.array(PublicCategorySchema),
  handler: async (req) => getPublicCategories(req.payload),
})
