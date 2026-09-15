import type { Payload } from 'payload'

import type { PublicPage } from '../../shared/contract/page'
import { toRichBlocks } from './richText'

/** ADR 0012 §3: GET /api/public/pages/:slug. Returns null on a 404. */
export async function getPublicPageBySlug(payload: Payload, slug: string): Promise<PublicPage | null> {
  const { docs } = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: false,
  })
  const page = docs[0]
  if (!page) return null

  return {
    slug: page.slug,
    title: page.title,
    content: toRichBlocks(page.content),
  }
}
