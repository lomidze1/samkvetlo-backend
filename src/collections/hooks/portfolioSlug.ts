import type { CollectionBeforeValidateHook } from 'payload'

import { slugify } from '../../lib/translit'

/**
 * Code review fix: the slug used to be regenerated from `church` on every
 * save (unconditionally, whenever `church` was present in the update
 * payload) — a second portfolio entry for the same church then failed the
 * unique constraint at create time, and renaming an existing entry's
 * church changed its public URL. Now: generate once (only while there is
 * no slug yet), with a `-2`, `-3`… suffix on a collision, and never touch
 * it again afterwards.
 */
export const generatePortfolioSlug: CollectionBeforeValidateHook = async ({ data, req, originalDoc }) => {
  if (!data) return data
  // A slug already exists (this is an update after the initial create) —
  // keep it stable even if `church` changes.
  if (originalDoc?.slug) return data
  if (typeof data.church !== 'string' || data.church.length === 0) return data

  const base = slugify(data.church)
  let candidate = base
  let suffix = 2
  for (;;) {
    const { totalDocs } = await req.payload.count({
      collection: 'portfolio',
      where: { slug: { equals: candidate } },
      overrideAccess: true,
    })
    if (totalDocs === 0) break
    candidate = `${base}-${suffix}`
    suffix += 1
  }

  return { ...data, slug: candidate }
}
