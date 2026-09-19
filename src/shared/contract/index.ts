// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
//
// Only `zod` may be imported here. No `payload`, no Node built-ins, no
// `@/collections/*` — this file is copied verbatim into the frontend repo.
import { z } from 'zod'

export const CONTRACT_VERSION = '2026-09-16.1'

export const HealthSchema = z.strictObject({
  ok: z.literal(true),
  contractVersion: z.string(),
})
export type Health = z.infer<typeof HealthSchema>

export const ErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
})
export type ApiError = z.infer<typeof ErrorSchema>

export * from './pagination'
export * from './image'
export * from './richText'
export * from './category'
export * from './product'
export * from './page'
export * from './portfolio'
export * from './siteSettings'
export * from './deliveryZone'
export * from './phone'
export * from './cart'
export * from './order'
export * from './customRequest'
export * from './shareLink'
export * from './sitemap'
export * from './redirect'
