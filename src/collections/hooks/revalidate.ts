import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, GlobalAfterChangeHook } from 'payload'

import { notifyRevalidate, type RevalidateTag } from '../../server/revalidate/notify'

/** ADR 0012 §5: a collection's afterChange -> notifyRevalidate(tags). */
export function revalidateAfterChange(tags: RevalidateTag[]): CollectionAfterChangeHook {
  return async ({ doc, req }) => {
    await notifyRevalidate(req.payload, tags, req.context)
    return doc
  }
}

/** ADR 0012 §5: a collection's afterDelete -> notifyRevalidate(tags). */
export function revalidateAfterDelete(tags: RevalidateTag[]): CollectionAfterDeleteHook {
  return async ({ doc, req }) => {
    await notifyRevalidate(req.payload, tags, req.context)
    return doc
  }
}

/** Same as revalidateAfterChange, for a GlobalConfig (e.g. site-settings). */
export function revalidateGlobalAfterChange(tags: RevalidateTag[]): GlobalAfterChangeHook {
  return async ({ doc, req }) => {
    await notifyRevalidate(req.payload, tags, req.context)
    return doc
  }
}
