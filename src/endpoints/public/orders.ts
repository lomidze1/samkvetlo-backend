import { OrderInputSchema, OrderResultSchema } from '../../shared/contract/order'
import { submitOrder } from '../../server/orders/submitOrder'
import { clientIpFromRequest, ipHashFromRequest } from '../../server/security/ipHash'
import { publicEndpoint } from './publicEndpoint'

export const ordersEndpoint = publicEndpoint({
  path: '/public/orders',
  method: 'post',
  scope: 'write',
  requireClientIp: true,
  input: OrderInputSchema,
  output: OrderResultSchema,
  handler: async (req, input) =>
    submitOrder(req.payload, input, {
      ipHash: ipHashFromRequest(req),
      clientIp: clientIpFromRequest(req),
    }),
})
