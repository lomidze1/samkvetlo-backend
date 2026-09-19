import * as Sentry from '@sentry/nextjs'

import { scrubBreadcrumb, scrubEvent } from '@/lib/security/scrubEvent'

// T5.10 (ADR 0014 §11): server + edge init live inline here rather than in
// separate sentry.server.config.ts/sentry.edge.config.ts files — this
// project's options don't differ between the two runtimes, so there's
// nothing those extra files would hold that `register()` can't do itself.
// No DSN (dev, and any env until the owner registers a project) means
// `Sentry.init` is never called — the SDK stays fully off. Server-only: the
// admin UI is an internal tool, not the public storefront, so there is no
// browser-side (instrumentation-client.ts) init here — see .env.example.
const dsn = process.env.SENTRY_DSN

export async function register() {
  if (!dsn) return
  if (process.env.NEXT_RUNTIME !== 'nodejs' && process.env.NEXT_RUNTIME !== 'edge') return

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    // No Replay — it's a browser-only integration and this file only ever
    // runs server/edge side.
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
}

// Server Components, proxy (middleware) and route handler errors.
export const onRequestError = Sentry.captureRequestError
