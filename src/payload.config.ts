import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig, type Config, type Plugin } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { PublicFiles } from './collections/PublicFiles'
import { PrivateFiles } from './collections/PrivateFiles'
import { Categories } from './collections/Categories'
import { Products } from './collections/Products'
import { Variants } from './collections/Variants'
import { Suppliers } from './collections/Suppliers'
import { Costings } from './collections/Costings'
import { ExchangeRates } from './collections/ExchangeRates'
import { Orders } from './collections/Orders'
import { Portfolio } from './collections/Portfolio'
import { Pages } from './collections/Pages'
import { DeliveryZones } from './collections/DeliveryZones'
import { CustomRequests } from './collections/CustomRequests'
import { ShareLinks } from './collections/ShareLinks'
import { AuditEvents } from './collections/AuditEvents'
import { ShortLinks } from './collections/ShortLinks'
import { PricingSettings } from './globals/PricingSettings'
import { SiteSettings } from './globals/SiteSettings'
import { healthEndpoint } from './endpoints/public/health'
import { siteSettingsEndpoint } from './endpoints/public/siteSettings'
import { categoriesEndpoint } from './endpoints/public/categories'
import { productsListEndpoint, productBySlugEndpoint } from './endpoints/public/products'
import { searchEndpoint } from './endpoints/public/search'
import { pageBySlugEndpoint } from './endpoints/public/pages'
import { portfolioListEndpoint, portfolioBySlugEndpoint } from './endpoints/public/portfolio'
import { deliveryZonesEndpoint } from './endpoints/public/deliveryZones'
import { cartQuoteEndpoint } from './endpoints/public/cartQuote'
import { ordersEndpoint } from './endpoints/public/orders'
import { customRequestsEndpoint } from './endpoints/public/customRequests'
import {
  shareLinkCreateEndpoint,
  shareLinkRevokeEndpoint,
  shareByTokenEndpoint,
} from './endpoints/public/shareLinks'
import { sitemapEndpoint } from './endpoints/public/sitemap'
import { redirectEndpoint } from './endpoints/public/redirect'
import { shortLinksEndpoint } from './endpoints/public/shortLinks'
import { cronRatesEndpoint } from './endpoints/cronRates'
import { cronRetentionEndpoint } from './endpoints/cronRetention'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// ADR 0013 §1: the S3 adapter only turns on when S3_BUCKET is configured
// (prod). Locally, files stay on disk and the backend serves them itself.
// alwaysInsertFields keeps the plugin's `prefix` column in the schema either
// way, so migrations generated locally match the prod (S3-enabled) schema.
const s3Config = {
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
}
const s3Plugins: Plugin[] = [
  s3Storage({
    enabled: Boolean(process.env.S3_BUCKET),
    alwaysInsertFields: true,
    collections: {
      media: { prefix: 'media', disablePayloadAccessControl: true },
      'public-files': { prefix: 'files', disablePayloadAccessControl: true },
    },
    bucket: process.env.S3_BUCKET || '',
    config: s3Config,
  }),
  // private-files: separate, non-public bucket (ADR 0013 §1) — never gets
  // disablePayloadAccessControl, so every read still goes through Payload's
  // collection access control (isAdmin).
  s3Storage({
    enabled: Boolean(process.env.S3_BUCKET && process.env.S3_PRIVATE_BUCKET),
    alwaysInsertFields: true,
    collections: {
      'private-files': true,
    },
    bucket: process.env.S3_PRIVATE_BUCKET || '',
    config: s3Config,
    clientCacheKey: 's3:private',
  }),
]

export default buildConfig({
  // No anonymous usage beacon to a third party not covered by any ADR —
  // also keeps tests that stub the global `fetch` to assert on our own
  // revalidate webhook (T1.11) from also catching Payload's own telemetry
  // call.
  telemetry: false,
  // ADR 0018 addendum C: `info` logs only the message; the QR response's
  // data (the enrollment secret) must never reach the server log. The type
  // lists only Payload's own error names; logError looks up any err.name.
  loggingLevels: { TotpEnrollmentRequired: 'info' } as NonNullable<Config['loggingLevels']>,
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' · სამკვეთლო',
    },
    components: {
      // T1.4: "P% დაუდასტურებელია" banner, visible only while
      // pricing-settings.pConfirmed = false (ADR 0006).
      beforeDashboard: ['/components/admin/PConfirmedBanner#PConfirmedBanner'],
      // Header "←" back button; moved left of the breadcrumb in custom.scss.
      actions: ['/components/admin/BackButton#BackButton'],
      // ADR 0018 (T5.17): replaces the built-in login view with one that
      // also submits a TOTP code, in the same request as the password.
      views: {
        login: {
          Component: '/components/admin/TotpLogin/TotpLoginView#TotpLoginView',
        },
      },
    },
  },
  collections: [
    Users,
    Media,
    PublicFiles,
    PrivateFiles,
    Categories,
    Products,
    Variants,
    Suppliers,
    Costings,
    ExchangeRates,
    Orders,
    Portfolio,
    Pages,
    DeliveryZones,
    CustomRequests,
    ShareLinks,
    AuditEvents,
    ShortLinks,
  ],
  globals: [PricingSettings, SiteSettings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.BACKEND_URL,
  // ADR 0014 §4: default is 10 — narrowed so a relationship/upload field
  // can't accidentally pull in several extra hops of populated documents.
  maxDepth: 3,
  cors: [],
  csrf: [process.env.BACKEND_URL].filter((value): value is string => Boolean(value)),
  endpoints: [
    healthEndpoint,
    siteSettingsEndpoint,
    categoriesEndpoint,
    productsListEndpoint,
    productBySlugEndpoint,
    searchEndpoint,
    pageBySlugEndpoint,
    portfolioListEndpoint,
    portfolioBySlugEndpoint,
    deliveryZonesEndpoint,
    cartQuoteEndpoint,
    ordersEndpoint,
    customRequestsEndpoint,
    shareLinkCreateEndpoint,
    shareLinkRevokeEndpoint,
    shareByTokenEndpoint,
    sitemapEndpoint,
    redirectEndpoint,
    shortLinksEndpoint,
    cronRatesEndpoint,
    cronRetentionEndpoint,
  ],
  graphQL: {
    disable: true,
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    // ADR 0018 addendum A (T5.17a): schema-push (Payload's dev-mode default,
    // `push: true`) silently applies config changes straight to the DB —
    // exactly what let `users_sessions` (and other schema) drift out of
    // sync with the tracked migrations in the first place (see
    // 20260919_080426_totp_admin_2fa.ts's comment). CI's `test:int` job
    // sets PAYLOAD_DB_PUSH=false (after running `payload migrate`) so a
    // migration gap fails there instead of being papered over by push;
    // local dev keeps push on (the default) for its usual speed.
    push: process.env.PAYLOAD_DB_PUSH !== 'false',
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  sharp,
  // ADR 0013 §7: root fileSize limit (4 MB, below Vercel's 4.5 MB body cap).
  // abortOnLimit turns an oversized upload into a 413 instead of a silently
  // truncated file.
  upload: {
    limits: { fileSize: 4_000_000 },
    abortOnLimit: true,
    responseOnLimit: 'ფოტო 4 MB-ზე დიდია. გამოიყენეთ ფოტოს სტანდარტის ექსპორტი (JPEG, 2400 px)',
  },
  plugins: s3Plugins,
})
