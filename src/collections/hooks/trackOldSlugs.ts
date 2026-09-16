import type { CollectionBeforeChangeHook, CollectionSlug, Where } from 'payload'

export interface OldSlugTrackable {
  id: number | string
  slug?: string | null
  oldSlugs?: { slug?: string | null }[] | null
}

interface TrackOldSlugsOptions<T extends OldSlugTrackable> {
  collection: CollectionSlug
  /**
   * Only push the retired slug onto `oldSlugs` when this returns true for
   * the pre-change doc (products: only if it was already published — an
   * unpublished product's old slug never leaked publicly, so it shouldn't
   * redirect). Omitted entirely for categories, which have no
   * published/draft concept.
   */
  shouldTrackRetiredSlug?: (originalDoc: T) => boolean
}

function slugsOf(entries: { slug?: string | null }[] | null | undefined): string[] {
  return (entries ?? []).map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug))
}

/**
 * T5.4 (301 redirects): keeps `oldSlugs[]` in sync on Products/Categories.
 * - On a slug change (update): retires the previous slug onto this doc's
 *   `oldSlugs` (subject to `shouldTrackRetiredSlug`).
 * - On create or update: drops the new slug from every *other* doc's
 *   `oldSlugs` in the same collection, in the same `req` (transaction) — a
 *   live slug always wins, so reusing a retired slug elsewhere severs that
 *   old redirect rather than creating a chain or ambiguity.
 */
export function trackOldSlugs<T extends OldSlugTrackable>({
  collection,
  shouldTrackRetiredSlug,
}: TrackOldSlugsOptions<T>): CollectionBeforeChangeHook<T> {
  return async ({ data, originalDoc, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') return data

    const newSlug = typeof data.slug === 'string' ? data.slug : undefined
    if (!newSlug) return data

    let nextData = data

    if (operation === 'update' && originalDoc) {
      const oldSlug = typeof originalDoc.slug === 'string' ? originalDoc.slug : undefined
      const slugChanged = Boolean(oldSlug) && oldSlug !== newSlug
      const shouldTrack = slugChanged && (!shouldTrackRetiredSlug || shouldTrackRetiredSlug(originalDoc))

      if (shouldTrack && oldSlug) {
        const retained = slugsOf(originalDoc.oldSlugs).filter((slug) => slug !== newSlug)
        nextData = { ...data, oldSlugs: [...retained.map((slug) => ({ slug })), { slug: oldSlug }] }
      }
    }

    const excludeId = originalDoc?.id
    const matchesNewSlug: Where = { 'oldSlugs.slug': { equals: newSlug } }
    const where: Where = excludeId ? { and: [{ id: { not_equals: excludeId } }, matchesNewSlug] } : matchesNewSlug

    const { docs: others } = await req.payload.find({
      collection,
      where,
      overrideAccess: true,
      depth: 0,
      limit: 0,
      req,
    })

    for (const other of others as OldSlugTrackable[]) {
      const remaining = slugsOf(other.oldSlugs).filter((slug) => slug !== newSlug)
      // Not payload.update(): products has versions/drafts, and update()
      // reads the *latest* version (which may be an unpublished draft) as
      // its base, then — since this call passes no `draft: true` — writes
      // that base back out as the published document. On a published
      // product with a pending draft edit, that would silently publish (or
      // merge in) the draft (code review finding, same hazard documented in
      // variantPricing.ts's recomputeProductPricing). db.updateOne() writes
      // straight to the row by id — no version read/merge, no hooks — so it
      // only ever touches this one denormalized field on the *live* row.
      // Categories have no versions/drafts, so this is just as correct
      // there, only simpler.
      await req.payload.db.updateOne({
        collection,
        id: other.id,
        data: { oldSlugs: remaining.map((slug) => ({ slug })) },
        req,
      })
    }

    return nextData
  }
}
