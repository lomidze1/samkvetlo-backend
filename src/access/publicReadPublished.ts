import type { Access } from 'payload'

/**
 * Like publicRead, but for collections with drafts enabled
 * (`versions.drafts`, e.g. products/portfolio). An anonymous reader (no
 * req.user) only ever sees `_status: 'published'` documents — Payload's own
 * REST/Local API otherwise happily returns drafts to an anonymous request
 * for `?draft=true` regardless of collection-level access, because that
 * query param only selects which version to read, not whether the reader
 * may see unpublished ones (ADR 0005: an unpublished product may still have
 * unreviewed documents/secret-adjacent copy).
 */
export const publicReadPublished: Access = ({ req }) => {
  if (req.user) return true
  return { _status: { equals: 'published' } }
}
