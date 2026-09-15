import type { PayloadRequest } from 'payload'

/**
 * Runs `fn` with `req.context.skipRevalidate = true` — silencing any
 * revalidateAfterChange/revalidateAfterDelete hook triggered by a nested
 * `payload.create`/`update` call inside it — then restores `req.context` to
 * exactly what it was before. `req` is shared by reference with the rest of
 * the outer request, so without the restore the flag would also silence a
 * later hook in the same request (e.g. the product's own revalidate, right
 * after createDefaultVariant's nested variant create).
 */
export async function withRevalidateSkipped<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const previousContext = req.context
  req.context = { ...req.context, skipRevalidate: true }
  try {
    return await fn()
  } finally {
    req.context = previousContext
  }
}
