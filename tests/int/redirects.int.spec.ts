// T5.4 (301/308 redirects, ADR 0002 slugs): trackOldSlugs.ts + the
// GET /api/public/redirect resolver.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { resolvePublicRedirect } from '@/server/public/redirect'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

    expect(await resolvePublicRedirect(payload, 'product', slugA)).toBe(`/product/${slugA}`)

    const oldDocAfter = await payload.findByID({ collection: 'products', id: oldDocId, overrideAccess: true })
    expect((oldDocAfter.oldSlugs ?? []).map((entry) => entry.slug)).not.toContain(slugA)
    void newDocId
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
})
