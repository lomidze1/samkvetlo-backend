import { withPayload } from '@payloadcms/next/withPayload'
import { withSentryConfig } from '@sentry/nextjs/config'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

// T5.8 (ADR 0014 §3): enforced on every response, same values as
// samkvetlo/next.config.ts's SECURITY_HEADERS (no CSP here — this is an
// internal admin tool, not a page rendering third-party scripts/embeds).
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  // T5.x SEO contract: nothing on this backend (admin, built-in REST,
  // /api/public/*) should ever be indexed — the storefront (samkvetlo) is
  // the only origin search engines should see.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: '/', destination: '/admin', permanent: false }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

// T5.10 (ADR 0014 §11): source maps only upload when a CI-provided auth
// token exists — a missing one (every env until the owner creates one)
// must not fail the build, just skip the upload silently. No `tunnelRoute`
// (chief-architect, T5.10): this is an internal admin tool, not a
// public page behind an ad blocker.
export default withSentryConfig(withPayload(nextConfig, { devBundleServerPackages: false }), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
})
