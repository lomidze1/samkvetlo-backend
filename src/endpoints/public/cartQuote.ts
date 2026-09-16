import { CartQuoteInputSchema, CartQuoteSchema } from '../../shared/contract/cart'
import { quoteCart } from '../../server/orders/quoteCart'
import { publicEndpoint } from './publicEndpoint'

export const cartQuoteEndpoint = publicEndpoint({
  path: '/public/cart/quote',
  method: 'post',
  scope: 'read',
  input: CartQuoteInputSchema,
  output: CartQuoteSchema,
  handler: async (req, input) => quoteCart(req.payload, input),
})
