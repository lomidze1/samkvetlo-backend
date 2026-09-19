// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { runSeed, teardownSeed } from '../../scripts/seed'

import { afterAll, describe, expect, it, beforeAll } from 'vitest'

let payload: Payload

describe('pnpm seed is idempotent (T1.10/T1.13)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  // Other int test files share this same database (samkvetlo_test) and
  // some (e.g. ratesRecompute.int.spec.ts) walk *every* row of a
  // collection — a seeded catalog left behind here would change their
  // counts, so this file cleans up after itself.
  afterAll(async () => {
    await teardownSeed(payload)
  })

  it('running the seed twice does not change the delivery-zones or products count', async () => {
    await runSeed(payload)
    const zonesBefore = await payload.count({ collection: 'delivery-zones', overrideAccess: true })
    const productsBefore = await payload.count({ collection: 'products', overrideAccess: true })

    await runSeed(payload)
    const zonesAfter = await payload.count({ collection: 'delivery-zones', overrideAccess: true })
    const productsAfter = await payload.count({ collection: 'products', overrideAccess: true })

    expect(zonesAfter.totalDocs).toBe(zonesBefore.totalDocs)
    expect(productsAfter.totalDocs).toBe(productsBefore.totalDocs)
    // ADR 0015, owner decision 2026-09-18: 3 distance-based zones (0 / 150 / 250 ₾).
    expect(zonesAfter.totalDocs).toBe(3)
  })

  it('seeds the default "tbilisi" zone at 0 ₾ / sortOrder 0', async () => {
    const { docs } = await payload.find({
      collection: 'delivery-zones',
      where: { slug: { equals: 'tbilisi' } },
      limit: 1,
      overrideAccess: true,
    })
    expect(docs[0]).toMatchObject({ feeGel: 0, sortOrder: 0, active: true })
  })
})
