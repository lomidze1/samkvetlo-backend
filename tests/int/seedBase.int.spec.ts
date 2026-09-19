// M4 (implementation-plan.md "MVP-მდე"): `pnpm seed:base` — the no-catalog
// subset of `pnpm seed` used before the owner has added real products.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { runBaseSeed, teardownSeed } from '../../scripts/seed'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const STATIC_PAGE_SLUGS = ['how-we-work', 'about', 'delivery', 'contact', 'privacy'] as const

describe('pnpm seed:base (M4): no catalog, idempotent, additive-only', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  // Same shared samkvetlo_test DB other int test files use (see
  // seed.int.spec.ts's own comment) — leave it as this file found it.
  afterAll(async () => {
    await teardownSeed(payload)
  })

  // This file shares samkvetlo_test with every other int test file in the
  // same run (fileParallelism: false, but nothing resets the DB between
  // files) — other files' own fixtures (products, categories, suppliers…)
  // can already be sitting in these tables when this one runs, same as
  // seed.int.spec.ts's own "does not change the count" test already
  // assumes. So "creates none" is asserted as a *delta* (before vs. after
  // runBaseSeed), never as an absolute zero.
  it('creates no products, categories, or portfolio items', async () => {
    const before = await Promise.all([
      payload.count({ collection: 'products', overrideAccess: true }),
      payload.count({ collection: 'categories', overrideAccess: true }),
      payload.count({ collection: 'portfolio', overrideAccess: true }),
    ])

    await runBaseSeed(payload)

    const after = await Promise.all([
      payload.count({ collection: 'products', overrideAccess: true }),
      payload.count({ collection: 'categories', overrideAccess: true }),
      payload.count({ collection: 'portfolio', overrideAccess: true }),
    ])
    expect(after[0].totalDocs).toBe(before[0].totalDocs)
    expect(after[1].totalDocs).toBe(before[1].totalDocs)
    expect(after[2].totalDocs).toBe(before[2].totalDocs)
  })

  it('creates no demo admin, no short-links, no sentinel supplier', async () => {
    const email = process.env.SEED_ADMIN_EMAIL
    const usersBefore = email
      ? (await payload.count({ collection: 'users', where: { email: { equals: email } }, overrideAccess: true })).totalDocs
      : null
    const shortLinksBefore = (await payload.count({ collection: 'short-links', overrideAccess: true })).totalDocs
    const suppliersBefore = (await payload.count({ collection: 'suppliers', overrideAccess: true })).totalDocs

    await runBaseSeed(payload)

    if (email && usersBefore !== null) {
      const { totalDocs } = await payload.count({ collection: 'users', where: { email: { equals: email } }, overrideAccess: true })
      expect(totalDocs).toBe(usersBefore)
    }
    const shortLinksAfter = (await payload.count({ collection: 'short-links', overrideAccess: true })).totalDocs
    expect(shortLinksAfter).toBe(shortLinksBefore)
    const suppliersAfter = (await payload.count({ collection: 'suppliers', overrideAccess: true })).totalDocs
    expect(suppliersAfter).toBe(suppliersBefore)
  })

  it('seeds the 3 ADR 0015 delivery zones and 5 static pages', async () => {
    const zones = await payload.count({ collection: 'delivery-zones', overrideAccess: true })
    expect(zones.totalDocs).toBe(3)

    for (const slug of STATIC_PAGE_SLUGS) {
      const { docs } = await payload.find({ collection: 'pages', where: { slug: { equals: slug } }, limit: 1, overrideAccess: true })
      expect(docs, `page "${slug}" should exist`).toHaveLength(1)
    }
  })

  it('pricing-settings reads the owner-confirmed defaults (ADR 0006) without needing to be seeded', async () => {
    const settings = await payload.findGlobal({ slug: 'pricing-settings', overrideAccess: true })
    expect(settings.pPercent).toBe(30)
    expect(settings.minMarkupGel).toBe(1500)
    expect(settings.maxMarkupUsd).toBe(2500)
    expect(settings.roundingStepGel).toBe(10)
  })

  it('site-settings gets a phone and at least one owner contact', async () => {
    const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
    expect(settings.phone).toBeTruthy()
    expect((settings.ownerEmails?.length ?? 0) + (settings.ownerPhones?.length ?? 0)).toBeGreaterThan(0)
  })

  it('running it twice is idempotent — same row counts, and never overwrites an edited page', async () => {
    const zonesBefore = await payload.count({ collection: 'delivery-zones', overrideAccess: true })
    const pagesBefore = await payload.count({ collection: 'pages', overrideAccess: true })

    // Simulate the owner having edited a seeded page in the admin.
    const { docs } = await payload.find({ collection: 'pages', where: { slug: { equals: 'about' } }, limit: 1, overrideAccess: true })
    const aboutPage = docs[0]!
    const ownerEditedTitle = 'რედაქტირებულია ადმინიდან (M4 int ტესტი)'
    await payload.update({ collection: 'pages', id: aboutPage.id, data: { title: ownerEditedTitle }, overrideAccess: true })

    await runBaseSeed(payload)
    await runBaseSeed(payload)

    const zonesAfter = await payload.count({ collection: 'delivery-zones', overrideAccess: true })
    const pagesAfter = await payload.count({ collection: 'pages', overrideAccess: true })
    expect(zonesAfter.totalDocs).toBe(zonesBefore.totalDocs)
    expect(pagesAfter.totalDocs).toBe(pagesBefore.totalDocs)

    const reloaded = await payload.findByID({ collection: 'pages', id: aboutPage.id, overrideAccess: true })
    expect(reloaded.title).toBe(ownerEditedTitle)
  })
})
