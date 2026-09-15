import type { PayloadRequest } from 'payload'

import { PaginatedSchema } from '../../shared/contract/pagination'
import { PublicProductCardSchema } from '../../shared/contract/product'
import { searchPublicProducts } from '../../server/public/search'
import { publicEndpoint } from './publicEndpoint'

export const searchEndpoint = publicEndpoint({
  path: '/public/search',
  method: 'get',
  scope: 'read',
  output: PaginatedSchema(PublicProductCardSchema),
  handler: async (req: PayloadRequest) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const q = url.searchParams.get('q') ?? ''
    return searchPublicProducts(req.payload, q)
  },
})
