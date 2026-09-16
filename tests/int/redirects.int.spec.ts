// T5.4 (301/308 redirects, ADR 0002 slugs): trackOldSlugs.ts + the
// GET /api/public/redirect resolver.
// @vitest-environment node
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { redirectEndpoint } from '@/endpoints/public/redirect'
import { resolvePublicRedirect } from '@/server/public/redirect'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'

let payload: Payload

const EMPTY_RICH_TEXT = {
  root: {
    type: 'root' as const,
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1 as const,
    children: [
      {
        type: 'paragraph' as const,
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1 as const,
        children: [{ type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const }],
      },
    ],
  },
}

const cleanup: { collection: 'categories' | 'products'; id: number }[] = []

async function createCategory(name: string, parent?: number): Promise<{ id: number; slug: string }> {
  const doc = await payload.create({
    collection: 'categories',
    data: { name, ...(parent ? { parent } : {}) },
    overrideAccess: true,
  })
  cleanup.push({ collection: 'categories', id: doc.id })
  return { id: doc.id, slug: doc.slug! }
}

async function createProduct(title: string, category: number, published: boolean): Promise<number> {
  const doc = await payload.create({
    collection: 'products',
    data: {
      title,
      category,
      tier: 'standard',
      description: EMPTY_RICH_TEXT,
      ...(published ? { _status: 'published' } : {}),
    },
    overrideAccess: true,
  })
  cleanup.push({ collection: 'products', id: doc.id })
  return doc.id
}

async function renameProduct(id: number, title: string): Promise<string> {
  const doc = await payload.update({ collection: 'products', id, data: { title }, overrideAccess: true })
  return doc.slug!
}

async function renameCategory(id: number, name: string, parent?: number): Promise<string> {
  const doc = await payload.update({
    collection: 'categories',
    id,
    data: { name, ...(parent !== undefined ? { parent } : {}) },
    overrideAccess: true,
  })
  return doc.slug!
}

describe('slug redirects (T5.4)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const { collection, id } of cleanup) {
      await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
    }
  })

  it('product: A -> B -> C leaves both A and B redirecting to C', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-${suffix}`)
    const id = await createProduct(`Redirect Product A ${suffix}`, category.id, true)
    const slugA = (await payload.findByID({ collection: 'products', id, overrideAccess: true })).slug!

    const slugB = await renameProduct(id, `Redirect Product B ${suffix}`)
    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBe(`/product/${slugB}`)

    const slugC = await renameProduct(id, `Redirect Product C ${suffix}`)
    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBe(`/product/${slugC}`)
    expect(await resolvePublicRedirect(payload, 'product', slugB)).toBe(`/product/${slugC}`)
  })

  it('product: a new doc reusing slug A wins, and A is dropped from the old doc', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-reuse-${suffix}`)
    const oldDocId = await createProduct(`Redirect Reuse A ${suffix}`, category.id, true)
    const slugA = (await payload.findByID({ collection: 'products', id: oldDocId, overrideAccess: true })).slug!
    await renameProduct(oldDocId, `Redirect Reuse B ${suffix}`)

    // oldDoc now has oldSlugs: [A] — sanity check before the reuse.
    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBe(
      `/product/${(await payload.findByID({ collection: 'products', id: oldDocId, overrideAccess: true })).slug}`,
    )

    // A brand-new doc created with title 'Redirect Reuse A ${suffix}' slugifies back to slugA.
    const newDocId = await createProduct(`Redirect Reuse A ${suffix}`, category.id, true)

    // slugA is now newDoc's *current* (live) slug, not a stale one — the
    // self-redirect guard (code review finding) correctly returns null
    // here: a real caller only reaches this resolver after a direct
    // product-page lookup for slugA already 404'd, which can't happen
    // while a live product owns that slug. "the new doc wins" is instead
    // verified directly below, against the live slug.
    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBeNull()

    const { docs: liveOwners } = await payload.find({
      collection: 'products',
      where: { slug: { equals: slugA } },
      overrideAccess: true,
      depth: 0,
    })
    expect(liveOwners).toHaveLength(1)
    expect(liveOwners[0]?.id).toBe(newDocId)

    const oldDocAfter = await payload.findByID({ collection: 'products', id: oldDocId, overrideAccess: true })
    expect((oldDocAfter.oldSlugs ?? []).map((entry) => entry.slug)).not.toContain(slugA)
  })

  it('code review: a slug reuse does not silently publish another product\'s pending draft', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-draft-bleed-${suffix}`)

    // B: published, then renamed — the rename retires B's original slug
    // onto B.oldSlugs (shouldTrackRetiredSlug = wasPublished, T5.4).
    const sharedSlugTitle = `Redirect Bleed Shared ${suffix}`
    const bId = await createProduct(sharedSlugTitle, category.id, true)
    const publishedTitle = `Redirect Bleed B Renamed ${suffix}`
    await renameProduct(bId, publishedTitle)

    // B now has an unreviewed pending draft sitting on top of its published
    // content — never saved with `draft: true` normally goes through the
    // admin UI's "Save draft" button.
    const draftTitle = `Redirect Bleed B UNREVIEWED DRAFT ${suffix}`
    await payload.update({
      collection: 'products',
      id: bId,
      data: { title: draftTitle },
      draft: true,
      overrideAccess: true,
    })

    // A new product reuses B's retired slug (title -> slugify ==
    // sharedSlugTitle's slug) — this is exactly the beforeChange cross-doc
    // cleanup in trackOldSlugs.ts running on B.
    await createProduct(sharedSlugTitle, category.id, true)

    // The published row (what the storefront/redirect resolver reads) must
    // be completely untouched by the cleanup — not just its title, but its
    // publish status.
    const publishedB = await payload.findByID({
      collection: 'products',
      id: bId,
      draft: false,
      overrideAccess: true,
    })
    expect(publishedB.title).toBe(publishedTitle)

    // B's pending draft must still be an unpublished draft — the cleanup
    // must not have silently published it.
    const latestB = await payload.findByID({
      collection: 'products',
      id: bId,
      draft: true,
      overrideAccess: true,
    })
    expect(latestB._status).toBe('draft')
    expect(latestB.title).toBe(draftTitle)
  })

  it('code review M1: an unrelated save on B does not resurrect a stale oldSlugs conflict with A', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-m1-${suffix}`)

    // B: created with slug X, then renamed to Y — retires X onto B.oldSlugs.
    const bId = await createProduct(`Redirect M1 X ${suffix}`, category.id, true)
    const slugX = (await payload.findByID({ collection: 'products', id: bId, overrideAccess: true })).slug!
    await renameProduct(bId, `Redirect M1 Y ${suffix}`)

    const bAfterRename = await payload.findByID({ collection: 'products', id: bId, overrideAccess: true })
    expect((bAfterRename.oldSlugs ?? []).map((entry) => entry.slug)).toEqual([slugX])

    // A reuses X as its own live slug — the cross-doc cleanup (db.updateOne,
    // blocker #1's fix) clears it from B's *main row*, but not from the
    // version row `payload.update()` uses as its merge base on B's next save.
    const aId = await createProduct(`Redirect M1 X ${suffix}`, category.id, true)
    const bAfterReuse = await payload.findByID({ collection: 'products', id: bId, overrideAccess: true })
    expect((bAfterReuse.oldSlugs ?? []).map((entry) => entry.slug)).not.toContain(slugX)

    // An UNRELATED save on B — touches neither slug nor oldSlugs. Without
    // the self-heal in trackOldSlugs.ts, Payload's own field-level merge
    // would restore oldSlugs from the (stale) version-row base, putting X
    // back on B while A also legitimately owns it live.
    await payload.update({
      collection: 'products',
      id: bId,
      data: { featured: true },
      overrideAccess: true,
    })

    const bAfterUnrelatedSave = await payload.findByID({ collection: 'products', id: bId, overrideAccess: true })
    expect(bAfterUnrelatedSave.featured).toBe(true)
    expect((bAfterUnrelatedSave.oldSlugs ?? []).map((entry) => entry.slug)).not.toContain(slugX)

    // The slug must resolve to exactly one live-or-retired owner: A.
    const { docs: owners } = await payload.find({
      collection: 'products',
      where: { or: [{ slug: { equals: slugX } }, { 'oldSlugs.slug': { equals: slugX } }] },
      overrideAccess: true,
      depth: 0,
    })
    expect(owners.map((doc) => doc.id)).toEqual([aId])
  })

  it('product: an unpublished product leaks no redirect', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-draft-${suffix}`)
    const id = await createProduct(`Redirect Draft A ${suffix}`, category.id, false)
    const slugA = (await payload.findByID({ collection: 'products', id, overrideAccess: true })).slug!

    await renameProduct(id, `Redirect Draft B ${suffix}`)

    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBeNull()
  })

  it('category: a moved/renamed category resolves to its correct nested path', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const parentA = await createCategory(`redirect-parent-a-${suffix}`)
    const parentB = await createCategory(`redirect-parent-b-${suffix}`)
    const child = await createCategory(`redirect-child-${suffix}`, parentA.id)

    expect(await resolvePublicRedirect(payload, 'category', child.slug)).toBe(`/${parentA.slug}/${child.slug}`)

    // Rename + move to a different parent in one update.
    const newChildSlug = await renameCategory(child.id, `redirect-child-renamed-${suffix}`, parentB.id)

    expect(await resolvePublicRedirect(payload, 'category', child.slug)).toBe(`/${parentB.slug}/${newChildSlug}`)
    // The full old path (not just the slug) is accepted too — only the last segment matters.
    expect(await resolvePublicRedirect(payload, 'category', `/${parentA.slug}/${child.slug}`)).toBe(
      `/${parentB.slug}/${newChildSlug}`,
    )
  })

  it('returns null for an unknown slug', async () => {
    expect(await resolvePublicRedirect(payload, 'product', 'not-a-real-slug-at-all')).toBeNull()
    expect(await resolvePublicRedirect(payload, 'category', 'not-a-real-slug-at-all')).toBeNull()
  })

  it('code review: a product lookup on its own current slug is not a redirect (would loop forever)', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await createCategory(`redirect-cat-selfloop-${suffix}`)
    const id = await createProduct(`Redirect Self Loop ${suffix}`, category.id, true)
    const currentSlug = (await payload.findByID({ collection: 'products', id, overrideAccess: true })).slug!

    expect(await resolvePublicRedirect(payload, 'product', currentSlug)).toBeNull()
  })

  it('code review: a category lookup on its own current full path is not a redirect (would loop forever)', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const parent = await createCategory(`redirect-parent-selfloop-${suffix}`)
    const child = await createCategory(`redirect-child-selfloop-${suffix}`, parent.id)
    const currentPath = `/${parent.slug}/${child.slug}`

    expect(await resolvePublicRedirect(payload, 'category', currentPath)).toBeNull()
    // A bare slug that omits a real parent segment is NOT a self-redirect —
    // resolving `child` -> `/parent/child` adds information, it doesn't loop.
    expect(await resolvePublicRedirect(payload, 'category', child.slug)).toBe(currentPath)
  })

  it('code review: a top-level category lookup on its own bare slug is not a redirect either', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const topLevel = await createCategory(`redirect-toplevel-selfloop-${suffix}`)

    expect(await resolvePublicRedirect(payload, 'category', topLevel.slug)).toBeNull()
  })

  // Code review finding: query params were hand-checked instead of
  // zod-validated — an unknown `type` 404'd instead of 400ing, and `path`
  // had no length limit.
  describe('GET /api/public/redirect — zod query validation (code review)', () => {
    function endpointRequest(query: string): PayloadRequest {
      return {
        url: `http://localhost:3001/api/public/redirect${query}`,
        headers: new Headers({ authorization: `Bearer ${READ_TOKEN}` }),
        payload,
      } as unknown as PayloadRequest
    }

    // Code review M2: the frontend (samkvetlo/src/lib/api/redirect.ts) only
    // treats a 404 as "no redirect" — anything else 500s the page. `type`
    // is always one of the two literals the frontend itself sends, so a
    // malformed `type` is a genuine 400. `path` comes from an arbitrary
    // URL segment, so anything wrong with it must 404, never 400.
    it('missing type -> 400 err.validation', async () => {
      const response = await redirectEndpoint.handler(endpointRequest('?path=foo'))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: { code: 'err.validation' } })
    })

    it('an unknown type -> 400, not 404', async () => {
      const response = await redirectEndpoint.handler(endpointRequest('?type=bogus&path=foo'))
      expect(response.status).toBe(400)
    })

    it('missing path -> 404, not 400 (the storefront never sends a malformed type)', async () => {
      const response = await redirectEndpoint.handler(endpointRequest('?type=product'))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'err.notFound' } })
    })

    it('a path over 200 characters -> 404, not 400 (would otherwise 500 the storefront)', async () => {
      const longPath = 'a'.repeat(201)
      const response = await redirectEndpoint.handler(endpointRequest(`?type=product&path=${longPath}`))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'err.notFound' } })
    })

    it('valid params but an unknown slug still 404s (unchanged)', async () => {
      const response = await redirectEndpoint.handler(
        endpointRequest('?type=product&path=not-a-real-slug-at-all'),
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: { code: 'err.notFound' } })
    })

    it('a valid product redirect still resolves end to end', async () => {
      const suffix = `${Date.now()}-${Math.random()}`
      const category = await createCategory(`redirect-endpoint-cat-${suffix}`)
      const id = await createProduct(`Redirect Endpoint A ${suffix}`, category.id, true)
      const slugA = (await payload.findByID({ collection: 'products', id, overrideAccess: true })).slug!
      const slugB = await renameProduct(id, `Redirect Endpoint B ${suffix}`)

      const response = await redirectEndpoint.handler(endpointRequest(`?type=product&path=${slugA}`))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ to: `/product/${slugB}` })
    })
  })
})
