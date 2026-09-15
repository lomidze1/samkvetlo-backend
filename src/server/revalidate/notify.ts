import type { Payload } from 'payload'

// ADR 0012 §5: the four coarse revalidation tags.
export type RevalidateTag = 'catalog' | 'pages' | 'portfolio' | 'settings'

const TIMEOUT_MS = 3000

/**
 * ADR 0012 §5: POSTs { tags } to the frontend's revalidate route with a
 * shared secret. Fire-and-forget in spirit — it never throws, so a failure
 * (frontend down, timeout) can never fail the admin save that triggered it;
 * the 1-hour `revalidate: 3600` fallback on every frontend fetch covers a
 * dropped webhook. `disableRevalidate` (seed script's `context`) skips the
 * request entirely.
 */
export async function notifyRevalidate(
  payload: Payload,
  tags: RevalidateTag[],
  context?: { disableRevalidate?: unknown },
): Promise<void> {
  if (context?.disableRevalidate === true) return

  const url = process.env.FRONTEND_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret) {
    payload.logger.warn('notifyRevalidate: FRONTEND_REVALIDATE_URL/REVALIDATE_SECRET not configured — skipping')
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ tags }),
      signal: controller.signal,
    })
    if (!response.ok) {
      payload.logger.error({ status: response.status, tags }, 'notifyRevalidate: frontend rejected the request')
    }
  } catch (err) {
    payload.logger.error({ err, tags }, 'notifyRevalidate: request failed')
  } finally {
    clearTimeout(timer)
  }
}
