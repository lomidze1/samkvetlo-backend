import { randomUUID } from 'node:crypto'
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
 *
 * INVARIANT (round 3 of code review — enforced, not patched per scenario):
 * every old slug belongs to *at most one* document in the collection, and
 * that document is the one that most recently held it as a live slug. A
 * legitimate `oldSlugs` entry is only ever added by this hook's own rename
 * path below, and that path removes the same slug from every other doc's
 * `oldSlugs` within the same operation — so any other appearance of an old
 * slug elsewhere is always a stale resurrection (from a version row a
 * direct `db.updateOne` write, see below, never touches), never a second
 * legitimate claim. Enforced two ways, on every create/update:
 * 1. Self-heal: before writing, this doc's own effective `oldSlugs` is
 *    stripped of any slug that is CURRENTLY another doc's live slug, or
 *    appears in another doc's `oldSlugs` — except the one slug (if any)
 *    this very save is retiring because of its own rename right now,
 *    which is exempt from both checks (see below).
 * 2. Cross-doc cleanup: a live slug always wins over every *other* doc's
 *    `oldSlugs` entry, and a slug this save just retired is likewise
 *    cleared from every other doc's `oldSlugs` — so the exemption in (1)
 *    never leaves a stale duplicate lying around; it becomes stale-and-
 *    about-to-be-cleaned instead.
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
    // Set only when this save retires a slug onto its own oldSlugs because
    // of a rename happening right now (see the invariant note above for
    // why it's exempt from the self-heal checks below).
    let retiringSlug: string | undefined

    if (operation === 'update' && originalDoc) {
      const oldSlug = typeof originalDoc.slug === 'string' ? originalDoc.slug : undefined
      const slugChanged = Boolean(oldSlug) && oldSlug !== newSlug
      const shouldTrack = slugChanged && (!shouldTrackRetiredSlug || shouldTrackRetiredSlug(originalDoc))

      // `originalDoc` here is built from the *latest version* (which can be
      // a pending draft, or simply stale, since the cross-doc cleanup below
      // writes only to the main row via db.updateOne and never touches
      // `_products_v`). Either way, `originalDoc.oldSlugs` is the value
      // Payload's own field-level merge would otherwise silently carry
      // forward into `data` on ANY update that doesn't itself touch
      // `oldSlugs` — including one that has nothing to do with slugs at
      // all (e.g. toggling `featured`). Setting `nextData.oldSlugs`
      // explicitly, on every update, pins the value this save writes
      // instead of leaving it to that fallback.
      let effectiveOldSlugs = slugsOf(originalDoc.oldSlugs).filter((slug) => slug !== newSlug)
      if (shouldTrack && oldSlug) {
        retiringSlug = oldSlug
        effectiveOldSlugs = [...effectiveOldSlugs, oldSlug]
      }

      // Self-heal: everything except `retiringSlug` is checked against
      // every other doc's live slug *and* their oldSlugs — a stale
      // resurrection can come back as either shape (reproduced by code
      // review round 3: B x->y, create A with slug x [clears B's live
      // oldSlugs], rename A x->w [A.oldSlugs = [x]], an unrelated save on
      // B would otherwise restore B's stale oldSlugs = [x] too, putting
      // `x` in both docs' oldSlugs at once). `retiringSlug` is exempt
      // because this doc was, by definition, just now live with it —
      // making it the correct, most-recent owner regardless of what a
      // stale copy elsewhere still (incorrectly) claims; the cross-doc
      // cleanup below is what actually clears that stale copy, in this
      // same operation.
      const toCheck = effectiveOldSlugs.filter((slug) => slug !== retiringSlug)
      if (toCheck.length > 0) {
        // Both `slug` and `oldSlugs.slug` are indexed (unique/index: true
        // on Products/Categories) — this stays a pair of index lookups,
        // not a collection scan, on every save.
        const { docs: elsewhere } = await req.payload.find({
          collection,
          where: {
            and: [
              ...(excludeId ? [{ id: { not_equals: excludeId } }] : []),
              { or: [{ slug: { in: toCheck } }, { 'oldSlugs.slug': { in: toCheck } }] },
            ],
          },
          overrideAccess: true,
          depth: 0,
          limit: 0,
          req,
        })
        const claimedElsewhere = new Set<string>()
        for (const doc of elsewhere as OldSlugTrackable[]) {
          if (doc.slug && toCheck.includes(doc.slug)) claimedElsewhere.add(doc.slug)
          for (const slug of slugsOf(doc.oldSlugs)) {
            if (toCheck.includes(slug)) claimedElsewhere.add(slug)
          }
        }
        effectiveOldSlugs = effectiveOldSlugs.filter((slug) => slug === retiringSlug || !claimedElsewhere.has(slug))
      }

      nextData = { ...data, oldSlugs: effectiveOldSlugs.map((slug) => ({ slug })) }
    }

    // Cross-doc cleanup: a live slug always wins over every OTHER doc's
    // `oldSlugs` entry, and — the invariant's other half — a slug this
    // save just retired onto itself is cleared from every other doc's
    // `oldSlugs` too, in this same operation. Together these two claimed
    // slugs are exactly what the self-heal exemption above relies on
    // actually being cleaned up, rather than left stale.
    const claimedSlugs = retiringSlug ? [newSlug, retiringSlug] : [newSlug]
    const matchesClaimedSlug: Where = { 'oldSlugs.slug': { in: claimedSlugs } }
    const where: Where = excludeId
      ? { and: [{ id: { not_equals: excludeId } }, matchesClaimedSlug] }
      : matchesClaimedSlug

    const { docs: others } = await req.payload.find({
      collection,
      where,
      overrideAccess: true,
      depth: 0,
      limit: 0,
      req,
    })

    for (const other of others as OldSlugTrackable[]) {
      const remaining = slugsOf(other.oldSlugs).filter((slug) => !claimedSlugs.includes(slug))
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
      //
      // `id: randomUUID()` on every row: this array table has no `_uuid`
      // column, so Payload's normal field-level write path is what
      // generates each row's id — a path this direct db.updateOne() call
      // skips entirely. Without an explicit id, the adapter tries to
      // INSERT with the id column left to its (nonexistent) SQL DEFAULT,
      // which is fine for zero rows (no INSERT at all) or was never
      // actually exercised with more than one before round 3's sequence
      // test — with two or more rows it fails outright: "null value in
      // column id violates not-null constraint".
      await req.payload.db.updateOne({
        collection,
        id: other.id,
        data: { oldSlugs: remaining.map((slug) => ({ id: randomUUID(), slug })) },
        req,
      })
    }

    return nextData
  }
}
