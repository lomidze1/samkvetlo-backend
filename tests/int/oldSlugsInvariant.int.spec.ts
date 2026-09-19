// Code review round 3 (T5.4, trackOldSlugs.ts): a hand-written, fixed
// sequence of operations across 3 products, replaying creates, renames
// back and forth, slug reuse (from both a live slug and another doc's
// oldSlugs), and unrelated saves — the same shapes of operation that
// produced round 1's blocker and rounds 2/3's stale-slug-resurrection
// findings. Deliberately NOT random/seeded: every step is a fixed line of
// code, so a failure always reproduces exactly the same way.
//
// INVARIANT (asserted after every single step): every old slug belongs to
// at most one document in the collection, and that document is the one
// that most recently held it as a live slug.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

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

async function createCategory(name: string): Promise<number> {
  const doc = await payload.create({ collection: 'categories', data: { name }, overrideAccess: true })
  cleanup.push({ collection: 'categories', id: doc.id })
  return doc.id
}

async function createProduct(title: string, category: number): Promise<{ id: number; slug: string }> {
  const doc = await payload.create({
    collection: 'products',
    data: { title, category, tier: 'standard', description: EMPTY_RICH_TEXT, _status: 'published' },
    overrideAccess: true,
  })
  cleanup.push({ collection: 'products', id: doc.id })
  return { id: doc.id, slug: doc.slug! }
}

async function renameProduct(id: number, title: string): Promise<string> {
  const doc = await payload.update({ collection: 'products', id, data: { title }, overrideAccess: true })
  return doc.slug!
}

async function toggleFeatured(id: number, featured: boolean): Promise<void> {
  await payload.update({ collection: 'products', id, data: { featured }, overrideAccess: true })
}

interface ProductState {
  id: number
  key: string
  slug: string
  oldSlugs: string[]
}

async function readState(docs: Record<string, number>): Promise<ProductState[]> {
  const states: ProductState[] = []
  for (const [key, id] of Object.entries(docs)) {
    const doc = await payload.findByID({ collection: 'products', id, overrideAccess: true })
    states.push({
      id,
      key,
      slug: doc.slug!,
      oldSlugs: (doc.oldSlugs ?? []).map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug)),
    })
  }
  return states
}

/**
 * Asserts the full invariant against the actual DB state:
 * 1. no doc lists its own current live slug as an old slug,
 * 2. no old slug appears in more than one doc's oldSlugs,
 * 3. every old slug's owner matches `mostRecentLiveHolder` — the doc key
 *    the test script itself most recently made live with that slug, kept
 *    up to date by the caller as ground truth (not re-derived from the DB).
 */
async function assertInvariant(
  docs: Record<string, number>,
  mostRecentLiveHolder: ReadonlyMap<string, string>,
): Promise<void> {
  const states = await readState(docs)
  const claimedBy = new Map<string, string>()

  for (const { key, slug, oldSlugs } of states) {
    for (const old of oldSlugs) {
      expect(old, `${key}: own live slug "${slug}" must not also be listed in its own oldSlugs`).not.toBe(slug)

      const claimant = claimedBy.get(old)
      expect(
        claimant,
        `slug "${old}" is claimed as an old slug by both "${claimant}" and "${key}" — must belong to at most one doc`,
      ).toBeUndefined()
      claimedBy.set(old, key)

      expect(
        mostRecentLiveHolder.get(old),
        `slug "${old}" is listed as old on "${key}", but the doc that most recently held it live was different`,
      ).toBe(key)
    }
  }
}

describe('trackOldSlugs invariant (code review round 3): fixed 15-step sequence across 3 products', () => {
  let categoryId: number
  let p1: number
  let p2: number
  let p3: number
  const docs: Record<string, number> = {}
  const mostRecentLiveHolder = new Map<string, string>()

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const suffix = `${Date.now()}-${Math.random()}`
    categoryId = await createCategory(`oldslugs-seq-cat-${suffix}`)
  })

  afterAll(async () => {
    for (const { collection, id } of cleanup) {
      await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
    }
  })

  it('replays the sequence, asserting the invariant after every step', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const title = (label: string) => `Seq ${label} ${suffix}`

    // Step 1: create P1.
    const p1c = await createProduct(title('S1'), categoryId)
    p1 = p1c.id
    docs.P1 = p1
    const s1 = p1c.slug
    mostRecentLiveHolder.set(s1, 'P1')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 2: create P2.
    const p2c = await createProduct(title('S2'), categoryId)
    p2 = p2c.id
    docs.P2 = p2
    const s2 = p2c.slug
    mostRecentLiveHolder.set(s2, 'P2')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 3: create P3.
    const p3c = await createProduct(title('S3'), categoryId)
    p3 = p3c.id
    docs.P3 = p3
    const s3 = p3c.slug
    mostRecentLiveHolder.set(s3, 'P3')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 4: rename P1 s1 -> s4. P1 retires s1 onto its own oldSlugs.
    const s4 = await renameProduct(p1, title('S4'))
    mostRecentLiveHolder.set(s4, 'P1')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 5: rename P2 s2 -> s1 — P2 reuses P1's retired s1 as its own
    // live slug. Cross-doc cleanup clears s1 from P1's oldSlugs (live
    // wins); P2 retires s2.
    const newS1 = await renameProduct(p2, title('S1'))
    expect(newS1).toBe(s1)
    mostRecentLiveHolder.set(s1, 'P2')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 6: unrelated save on P1 — regression check. P1's *version* row
    // from step 4 still has oldSlugs = [s1], now live on P2: caught by the
    // live-slug self-heal check alone.
    await toggleFeatured(p1, true)
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 7: rename P3 s3 -> s5 (fresh slug, no reuse). P3 retires s3.
    const s5 = await renameProduct(p3, title('S5'))
    mostRecentLiveHolder.set(s5, 'P3')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 8: rename P3 s5 -> s2 — P3 reuses P2's retired s2. Cross-doc
    // cleanup clears s2 from P2's oldSlugs (live wins); P3 retires s5
    // (s3 stays, untouched, on P3's oldSlugs).
    const newS2 = await renameProduct(p3, title('S2'))
    expect(newS2).toBe(s2)
    mostRecentLiveHolder.set(s2, 'P3')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 9: rename P1 s4 -> s6 (fresh). P1 retires s4.
    const s6 = await renameProduct(p1, title('S6'))
    mostRecentLiveHolder.set(s6, 'P1')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 10: rename P3 s2 -> s7 (fresh) — P3 moves off s2. s2 is now
    // retired on P3's oldSlugs and, critically, NOT live anywhere. P2 has
    // not been saved for real since step 5, so its *version* row still has
    // oldSlugs = [s2] — stale, and a live-only self-heal check would miss
    // it entirely now that nothing is live with s2.
    const s7 = await renameProduct(p3, title('S7'))
    mostRecentLiveHolder.set(s7, 'P3')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 11 (the round-3 gap, exercised here): unrelated save on P2 —
    // its first real save since step 5. Without checking other docs'
    // oldSlugs (not just their live slug), P2's stale version-row base
    // would resurrect oldSlugs = [s2] here, duplicating P3's legitimate
    // claim on s2 (which is retired on P3, not live anywhere).
    await toggleFeatured(p2, true)
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 12: rename P2 s1 -> s8 (fresh). P2 retires s1.
    const s8 = await renameProduct(p2, title('S8'))
    mostRecentLiveHolder.set(s8, 'P2')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 13: unrelated save on P3 — stability check.
    await toggleFeatured(p3, true)
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 14: rename P1 s6 -> s2 — P1 reclaims s2, which is currently
    // sitting in P3's oldSlugs (not live anywhere). Cross-doc cleanup must
    // clear s2 from P3's oldSlugs too, not just from a live slug match.
    const newS2Again = await renameProduct(p1, title('S2'))
    expect(newS2Again).toBe(s2)
    mostRecentLiveHolder.set(s2, 'P1')
    await assertInvariant(docs, mostRecentLiveHolder)

    // Step 15: unrelated save on P1 — final stability check.
    await toggleFeatured(p1, false)
    await assertInvariant(docs, mostRecentLiveHolder)
  })
})
