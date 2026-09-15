import { z } from 'zod'

import { PublicDeliveryZoneSchema } from '../../shared/contract/deliveryZone'
import { getPublicDeliveryZones } from '../../server/public/deliveryZones'
import { publicEndpoint } from './publicEndpoint'

export const deliveryZonesEndpoint = publicEndpoint({
  path: '/public/delivery-zones',
  method: 'get',
  scope: 'read',
  output: z.array(PublicDeliveryZoneSchema),
  handler: async (req) => getPublicDeliveryZones(req.payload),
})
