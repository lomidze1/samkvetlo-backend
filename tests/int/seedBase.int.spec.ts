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

  // M11 review fix (medium #1): runBaseSeed is meant to run against a
  // fresh *production* database — it must never write the dev-only
  // placeholder phone (`+995 555 00 00 00`) or owner contacts
  // (`owner@samkvetlo.local`/`+995500000000`) there. A real customer's
  // order notification going to that placeholder phone would reach
  // whoever actually holds that Georgian number, not the owner.
  it('leaves phone and owner contacts empty when nothing is already set and no SEED_* env override is given', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { phone: '', phoneSecondary: '', ownerEmails: [], ownerPhones: [] },
      overrideAccess: true,
    })

    await runBaseSeed(payload)

    const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
    expect(settings.phone).toBeFalsy()
    expect(settings.ownerEmails ?? []).toHaveLength(0)
    expect(settings.ownerPhones ?? []).toHaveLength(0)
  })

  it('takes real values from SEED_SITE_PHONE/SEED_OWNER_EMAIL/SEED_OWNER_PHONE when set', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { phone: '', phoneSecondary: '', ownerEmails: [], ownerPhones: [] },
      overrideAccess: true,
    })

    process.env.SEED_SITE_PHONE = '+995 32 200 00 00'
    process.env.SEED_OWNER_EMAIL = 'real-owner@example.com'
    process.env.SEED_OWNER_PHONE = '+995322000001'
    try {
      await runBaseSeed(payload)
    } finally {
      delete process.env.SEED_SITE_PHONE
      delete process.env.SEED_OWNER_EMAIL
      delete process.env.SEED_OWNER_PHONE
    }

    const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
    expect(settings.phone).toBe('+995 32 200 00 00')
    expect(settings.ownerEmails?.map((e) => e.email)).toEqual(['real-owner@example.com'])
    expect(settings.ownerPhones?.map((p) => p.phone)).toEqual(['+995322000001'])

    // Restore the same dev-only placeholder `runSeed`/other int test files
    // in this shared DB expect to find (see ensureSiteSettingsPhone/
    // ensureSiteSettingsOwnerContacts in scripts/seed.ts) — this test's own
    // reset above must not leak an empty site-settings into files that run
    // after this one in the same samkvetlo_test DB.
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        phone: '+995 555 00 00 00',
        phoneSecondary: '+995 555 00 00 01',
        ownerEmails: [{ email: 'owner@samkvetlo.local' }],
        ownerPhones: [{ phone: '+995500000000' }],
      },
      overrideAccess: true,
    })
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
