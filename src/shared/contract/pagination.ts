// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

/** Generic paginated envelope (ADR 0012 §3), shared by every list endpoint. */
export function PaginatedSchema<Item extends z.ZodTypeAny>(item: Item) {
  return z.strictObject({
    docs: z.array(item),
    page: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    totalDocs: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
    limit: z.number().int().positive(),
  })
}

export interface Paginated<T> {
  docs: T[]
  page: number
  totalPages: number
  totalDocs: number
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
}
