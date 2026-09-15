// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012 §3, ADR 0015)
import { z } from 'zod'

export const PublicDeliveryZoneSchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  examples: z.string().nullable(),
  feeGel: z.number().int().nonnegative(),
})
export type PublicDeliveryZone = z.infer<typeof PublicDeliveryZoneSchema>
