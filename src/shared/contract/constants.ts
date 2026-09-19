// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012 §3)
//
// No imports here — not even zod (unlike every other file in this
// directory). M14: the frontend's root-layout-loaded modules (the cart
// store, the category filter toolbar) import these five constants straight
// from this file instead of from cart.ts/product.ts/customRequest.ts or the
// `@/shared/contract` barrel, so loading them never pulls each schema
// module's `import { z } from 'zod'` into the shared (every-route) JS chunk.
// cart.ts, product.ts and customRequest.ts re-export the same values, so the
// public contract API is unchanged for every other consumer.

// ADR 0014 §5: cart <= 30 lines, qty 1-20.
export const CART_LINE_MAX_QTY = 20
export const CART_MAX_LINES = 30

export const COATING_VALUES = ['gilding', 'silvering', 'gold-leaf', 'enamel', 'none'] as const

export const AVAILABILITY_VALUES = ['ready', 'made-to-order'] as const

// ADR 0011 §3: the 5 categories the owner asked for, plus "other".
export const CUSTOM_REQUEST_CATEGORY_VALUES = [
  'iconostasis',
  'vestments',
  'vessels',
  'icon',
  'other',
] as const
