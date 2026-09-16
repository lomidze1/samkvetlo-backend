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
    const excludeId = originalDoc?.id

    if (operation === 'update' && originalDoc) {
      const oldSlug = typeof originalDoc.slug === 'string' ? originalDoc.slug : undefined
      const slugChanged = Boolean(oldSlug) && oldSlug !== newSlug
      const shouldTrack = slugChanged && (!shouldTrackRetiredSlug || shouldTrackRetiredSlug(originalDoc))

      // `originalDoc` here is built from the *latest version* (which can be
      // a pending draft, or — the self-heal case, code review M1 — simply
      // stale, since the cross-doc cleanup below writes only to the main
      // row via db.updateOne and never touches `_products_v`). Either way,
      // `originalDoc.oldSlugs` is the value Payload's own field-level merge
      // would otherwise silently carry forward into `data` on ANY update
      // that doesn't itself touch `oldSlugs` — including one that has
      // nothing to do with slugs at all (e.g. toggling `featured`). Setting
      // `nextData.oldSlugs` explicitly, on every update, pins the value
      // this save writes instead of leaving it to that fallback.
      let effectiveOldSlugs = slugsOf(originalDoc.oldSlugs).filter((slug) => slug !== newSlug)
      if (shouldTrack && oldSlug) {
        effectiveOldSlugs = [...effectiveOldSlugs, oldSlug]
      }

      // Self-heal: strip any slug that is CURRENTLY another doc's *live*
      // slug. Without this, a stale `oldSlugs` entry surviving in a
      // version row (see above) would keep resurrecting itself on every
      // future unrelated save, even after the cross-doc cleanup below
      // already cleared it once — reproduced by the code review: rename
      // B x->y, create A with slug x (clears B's live oldSlugs to []), a
      // later unrelated save on B (e.g. featured: true) would otherwise
      // put `x` back on B while A also legitimately owns it live.
      if (effectiveOldSlugs.length > 0) {
        const { docs: liveElsewhere } = await req.payload.find({
          collection,
          where: {
            and: [
              ...(excludeId ? [{ id: { not_equals: excludeId } }] : []),
              { slug: { in: effectiveOldSlugs } },
            ],
          },
          overrideAccess: true,
          depth: 0,
          limit: 0,
          req,
        })
        const liveSlugsElsewhere = new Set(
          (liveElsewhere as OldSlugTrackable[]).map((doc) => doc.slug).filter((slug): slug is string => Boolean(slug)),
        )
        effectiveOldSlugs = effectiveOldSlugs.filter((slug) => !liveSlugsElsewhere.has(slug))
      }

      nextData = { ...data, oldSlugs: effectiveOldSlugs.map((slug) => ({ slug })) }
    }

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
