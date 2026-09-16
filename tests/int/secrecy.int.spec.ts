// ADR 0005 (supplier-data secrecy) T1 + T2, run against SEED_SENTINEL=1
// (tests/fixtures/sentinel.ts). This is the CI merge gate — see T1.10.
// @vitest-environment node
import { getPayload, type AccessArgs, type Payload, type PayloadRequest } from 'payload'
import { REST_GET } from '@payloadcms/next/routes'
import config from '@/payload.config'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Suppliers } from '@/collections/Suppliers'
import { Costings } from '@/collections/Costings'
import { Orders } from '@/collections/Orders'
import { PrivateFiles } from '@/collections/PrivateFiles'
import { ExchangeRates } from '@/collections/ExchangeRates'
import { CustomRequests } from '@/collections/CustomRequests'
import { ShareLinks } from '@/collections/ShareLinks'

import { getPublicCategories } from '@/server/public/category'
import { getPublicSiteSettings } from '@/server/public/siteSettings'
import { getPublicProductCards, getPublicProductBySlug } from '@/server/public/product'
import { getPublicPageBySlug } from '@/server/public/page'
import { getPublicPortfolio, getPublicPortfolioBySlug } from '@/server/public/portfolio'
import { getPublicDeliveryZones } from '@/server/public/deliveryZones'
import { getPublicShareByToken } from '@/server/public/share'
import { generateOwnerSecret, generateToken, hashOwnerSecret, hashToken } from '@/server/share/token'

import { runSeed, teardownSeed } from '../../scripts/seed'
import { SENTINEL } from '../fixtures/sentinel'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let sentinelProductSlug: string
let sentinelVariantId: number
let sentinelOrderId: number | string
let sentinelCustomRequestId: number | string
let sentinelShareLinkId: number | string
let sentinelShareLinkToken: string
let pageSlugForSweep: string | null = null
const cleanupIds: {
  collection: 'categories' | 'custom-requests' | 'orders' | 'pages' | 'products' | 'public-files' | 'share-links'
  id: number | string
}[] = []

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'

const anonymousAccess = { req: { user: null } } as unknown as AccessArgs

const EMPTY_RICH_TEXT = {
  root: {
    type: 'root' as const,
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1 as const,
    children: [
      {
        type: 'paragraph' as const,
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1 as const,
        children: [{ type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const }],
      },
    ],
  },
}

/**
 * Creates its own dedicated sentinel-bearing product, independent of the
 * general seed script's idempotent-by-slug catalog: another test file that
 * ran `runSeed` earlier in the same suite without SEED_SENTINEL=1 would
 * otherwise have already created the seed catalog's own products, and
 * `runSeed`'s idempotent skip (by slug) means calling it again here with
 * SEED_SENTINEL=1 would never touch (or sentinel-fy) their documents.
 */
async function createSentinelProduct(): Promise<{ slug: string; variantId: number }> {
  const suffix = `${Date.now()}-${Math.random()}`
  const category = await payload.create({
    collection: 'categories',
    data: { name: `sentinel-test-cat-${suffix}` },
    overrideAccess: true,
  })
  cleanupIds.push({ collection: 'categories', id: category.id })

  const pdf = await fs.readFile(path.resolve(__dirname, '../fixtures/sample.pdf'))
  const publicFile = await payload.create({
    collection: 'public-files',
    data: {},
    file: { data: pdf, mimetype: 'application/pdf', name: 'certificate.pdf', size: pdf.length },
    overrideAccess: true,
  })
  cleanupIds.push({ collection: 'public-files', id: publicFile.id })

  const product = await payload.create({
    collection: 'products',
    data: {
      title: `sentinel-test-product-${suffix}`,
      category: category.id,
      tier: 'standard',
      description: EMPTY_RICH_TEXT,
      documents: [
        {
          title: 'სერტიფიკატი',
          kind: 'certificate',
          file: publicFile.id,
          issuer: SENTINEL.supplierName,
          reviewedNoSecretInfo: true,
        },
      ],
      _status: 'published',
    },
    overrideAccess: true,
  })
  cleanupIds.push({ collection: 'products', id: product.id })

  const { docs: variants } = await payload.find({
    collection: 'variants',
    where: { product: { equals: product.id } },
    limit: 1,
    overrideAccess: true,
  })

  return { slug: product.slug!, variantId: variants[0]!.id }
}

/** Sets every SiteSettings field-access-protected field to a sentinel value. */
async function setSentinelSiteSettings(): Promise<void> {
  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      ownerEmails: [{ email: SENTINEL.ownerEmail }],
      ownerPhones: [{ phone: SENTINEL.ownerPhone }],
      notifyCustomer: true,
      shareLinkTtlDays: SENTINEL.shareLinkTtlDays,
    },
    overrideAccess: true,
  })
}

async function resetSiteSettings(): Promise<void> {
  await payload.updateGlobal({
    slug: 'site-settings',
    data: { ownerEmails: [], ownerPhones: [], notifyCustomer: false, shareLinkTtlDays: 90 },
    overrideAccess: true,
  })
}

/** An Order carrying sentinel PII in every customer-facing field (D25). */
async function createSentinelOrder(variantId: number): Promise<number | string> {
  const order = await payload.create({
    collection: 'orders',
    data: {
      submissionId: `sentinel-order-${Date.now()}-${Math.random()}`,
      name: SENTINEL.orderCustomerName,
      surname: SENTINEL.orderCustomerSurname,
      phone: SENTINEL.orderCustomerPhone,
      church: SENTINEL.orderCustomerChurch,
      email: SENTINEL.orderCustomerEmail,
      comment: SENTINEL.orderCustomerName,
      items: [
        { variant: variantId, productTitle: 'x', variantTitle: 'x', sku: 'SMK-SENTINEL', unitPrice: 100, qty: 1 },
      ],
      deliveryZone: { slug: 'tbilisi', name: 'თბილისი' },
      deliveryFeeGel: 0,
      status: 'new',
    },
    overrideAccess: true,
  })
  return order.id
}

/** A custom-request carrying sentinel PII in every customer-facing + internal field (D25, T3.7). */
async function createSentinelCustomRequest(): Promise<number | string> {
  const request = await payload.create({
    collection: 'custom-requests',
    data: {
      submissionId: `sentinel-custom-request-${Date.now()}-${Math.random()}`,
      name: SENTINEL.customRequestName,
      surname: SENTINEL.customRequestSurname,
      phone: SENTINEL.customRequestPhone,
      church: SENTINEL.customRequestChurch,
      email: SENTINEL.customRequestEmail,
      category: 'other',
      description: SENTINEL.customRequestDescription,
      internalNotes: SENTINEL.customRequestInternalNotes,
      status: 'new',
    },
    overrideAccess: true,
  })
  return request.id
}

/**
 * A plain (non-PII) share-link — cartLines only ever carry a variantId/qty,
 * never supplier/cost/PII data, so there's nothing to sentinel-taint here.
 * This still exercises the one narrow overrideAccess: true lookup
 * (src/server/public/share.ts) and its DTO key-shape allowlist.
 */
async function createSentinelShareLink(variantId: number): Promise<{ id: number | string; token: string }> {
  const token = generateToken()
  const ownerSecret = generateOwnerSecret()
  const doc = await payload.create({
    collection: 'share-links',
    data: {
      kind: 'cart',
      tokenHash: hashToken(token),
      ownerSecretHash: hashOwnerSecret(ownerSecret),
      cartLines: [{ variantId, qty: 1 }],
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      viewCount: 0,
    },
    overrideAccess: true,
  })
  return { id: doc.id, token }
}

/** Reuses an existing page if one is already seeded (e.g. by pages.int.spec.ts); creates one otherwise. */
async function ensurePageForSweep(): Promise<string | null> {
  const { docs } = await payload.find({ collection: 'pages', limit: 1, overrideAccess: true })
  if (docs[0]) return docs[0].slug
  const page = await payload.create({
    collection: 'pages',
    data: { slug: 'about', title: 'ჩვენს შესახებ', content: EMPTY_RICH_TEXT },
    overrideAccess: true,
  })
  cleanupIds.push({ collection: 'pages', id: page.id })
  return page.slug
}

const SENTINEL_PATTERN = /ZZSENT|987654/i // i: email sentinels are lowercase

function assertNoSentinel(label: string, value: unknown): void {
  expect(JSON.stringify(value), label).not.toMatch(SENTINEL_PATTERN)
}

/**
 * D19 (ADR 0005/0009): `documents[*].issuer` is the one place a supplier
 * name is allowed, even in the *raw* built-in REST document (it isn't
 * field-access-restricted at all — it's simply public). Recursively drops
 * every `documents` key before the blanket sentinel check, same as the DTO
 * checks above strip it explicitly.
 */
function stripDocuments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDocuments)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'documents')
        .map(([key, entry]) => [key, stripDocuments(entry)]),
    )
  }
  return value
}

function serviceRequest(
  token: string,
  url: string,
  routeParams: Record<string, string> = {},
): PayloadRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return { payload, headers, routeParams, url } as unknown as PayloadRequest
}

/**
 * `templatePath` is the endpoint's *registered* path (e.g.
 * '/public/pages/:slug', used to find it in config.endpoints);
 * `concreteUrlPath` is the real URL path for the request/logging.
 */
async function callEndpoint(
  templatePath: string,
  routeParams?: Record<string, string>,
  concreteUrlPath: string = templatePath,
): Promise<Response> {
  const config2 = await config
  const endpoint = config2.endpoints?.find((entry) => 'path' in entry && entry.path === templatePath)
  if (!endpoint || !('handler' in endpoint)) throw new Error(`endpoint not found: ${templatePath}`)
  const req = serviceRequest(READ_TOKEN, `http://localhost:3001/api${concreteUrlPath}`, routeParams)
  return endpoint.handler(req)
}

/** Payload's *built-in* REST (not /api/public/*), called anonymously (no auth at all). */
async function callBuiltInRestAnonymously(slugSegments: string[]): Promise<Response> {
  const handler = REST_GET(config)
  const request = new Request(`http://localhost:3001/api/${slugSegments.join('/')}`, { method: 'GET' })
  return handler(request, { params: Promise.resolve({ slug: slugSegments }) })
}

describe('supplier-data secrecy (ADR 0005) — T1 unit', () => {
  it('suppliers/costings/orders/private-files/exchange-rates/custom-requests/share-links deny an anonymous read', async () => {
    expect(await Suppliers.access!.read!(anonymousAccess)).toBe(false)
    expect(await Costings.access!.read!(anonymousAccess)).toBe(false)
    expect(await Orders.access!.read!(anonymousAccess)).toBe(false)
    expect(await PrivateFiles.access!.read!(anonymousAccess)).toBe(false)
    expect(await ExchangeRates.access!.read!(anonymousAccess)).toBe(false)
    expect(await CustomRequests.access!.read!(anonymousAccess)).toBe(false)
    expect(await ShareLinks.access!.read!(anonymousAccess)).toBe(false)
  })
})

describe('supplier-data secrecy (ADR 0005) — T2 integration (SEED_SENTINEL=1)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    process.env.SEED_SENTINEL = '1'
    await runSeed(payload)
    const sentinelProduct = await createSentinelProduct()
    sentinelProductSlug = sentinelProduct.slug
    sentinelVariantId = sentinelProduct.variantId
    await setSentinelSiteSettings()
    sentinelOrderId = await createSentinelOrder(sentinelVariantId)
    sentinelCustomRequestId = await createSentinelCustomRequest()
    const shareLink = await createSentinelShareLink(sentinelVariantId)
    sentinelShareLinkId = shareLink.id
    sentinelShareLinkToken = shareLink.token
    pageSlugForSweep = await ensurePageForSweep()
  })

  afterAll(async () => {
    delete process.env.SEED_SENTINEL
    await resetSiteSettings()
    await payload.delete({ collection: 'orders', id: sentinelOrderId, overrideAccess: true }).catch(() => undefined)
    await payload
      .delete({ collection: 'custom-requests', id: sentinelCustomRequestId, overrideAccess: true })
      .catch(() => undefined)
    await payload
      .delete({ collection: 'share-links', id: sentinelShareLinkId, overrideAccess: true })
      .catch(() => undefined)
    for (const { collection, id } of cleanupIds) {
      await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
    }
    // Other int test files share this same database — see seed.int.spec.ts.
    await teardownSeed(payload)
  })

  it('src/server/public/* exports never leak a sentinel value, and every DTO shape matches its key snapshot', async () => {
    const categories = await getPublicCategories(payload)
    assertNoSentinel('categories', categories)
    if (categories[0]) expect(Object.keys(categories[0]).sort()).toEqual(['children', 'name', 'slug'])

    const siteSettings = await getPublicSiteSettings(payload)
    assertNoSentinel('site-settings', siteSettings)
    expect(Object.keys(siteSettings).sort()).toEqual([
      'address',
      'configuratorEnabled',
      'email',
      'phone',
      'social',
    ])

    const zones = await getPublicDeliveryZones(payload)
    assertNoSentinel('delivery-zones', zones)
    if (zones[0]) expect(Object.keys(zones[0]).sort()).toEqual(['examples', 'feeGel', 'name', 'slug'])

    const cards = await getPublicProductCards(payload, {})
    assertNoSentinel('product cards', cards)
    expect(Object.keys(cards).sort()).toEqual([
      'docs',
      'hasNextPage',
      'hasPrevPage',
      'limit',
      'page',
      'totalDocs',
      'totalPages',
    ])
    if (cards.docs[0]) {
      expect(Object.keys(cards.docs[0]).sort()).toEqual([
        'category',
        'featured',
        'image',
        'isPurchasable',
        'minPrice',
        'slug',
        'tier',
        'title',
      ])
    }

    const portfolio = await getPublicPortfolio(payload)
    assertNoSentinel('portfolio list', portfolio)
    if (portfolio[0]) {
      expect(Object.keys(portfolio[0]).sort()).toEqual(['church', 'city', 'photos', 'products', 'slug'])
      assertNoSentinel('portfolio item', await getPublicPortfolioBySlug(payload, portfolio[0].slug))
    }

    if (pageSlugForSweep) {
      const page = await getPublicPageBySlug(payload, pageSlugForSweep)
      assertNoSentinel('page', page)
      if (page) expect(Object.keys(page).sort()).toEqual(['content', 'slug', 'title'])
    }

    // D19 exception: documents[*].issuer legitimately carries the supplier
    // name — stripped before the blanket check, then checked positively (it
    // must be there, and *only* there).
    const sentinelProduct = await getPublicProductBySlug(payload, sentinelProductSlug)
    expect(sentinelProduct).toBeTruthy()
    expect(Object.keys(sentinelProduct!).sort()).toEqual([
      'category',
      'description',
      'documents',
      'featured',
      'features',
      'gallery',
      'isPurchasable',
      'minPrice',
      'slug',
      'sound',
      'tier',
      'title',
      'variants',
      'videos',
      'whyQuality',
    ])
    const { documents, ...productWithoutDocuments } = sentinelProduct!
    assertNoSentinel('product detail (minus documents)', productWithoutDocuments)
    expect(documents.some((doc) => doc.issuer === SENTINEL.supplierName)).toBe(true)
    for (const doc of documents) {
      if (doc.issuer !== SENTINEL.supplierName) assertNoSentinel('document', doc)
    }

    // T3.8: the one narrow overrideAccess: true lookup (src/server/public/
    // share.ts) — its DTO carries only variantId/qty-derived, re-priced
    // public data, never tokenHash/ownerSecretHash/ipHash.
    const shareDto = await getPublicShareByToken(payload, sentinelShareLinkToken)
    expect(shareDto).toBeTruthy()
    assertNoSentinel('share DTO', shareDto)
    expect(Object.keys(shareDto!).sort()).toEqual(['expiresAt', 'itemsTotalGel', 'kind', 'lines'])
  })

  it('every /api/public/* endpoint (read token) never leaks a sentinel value', async () => {
    for (const path of ['/public/categories', '/public/site-settings', '/public/portfolio', '/public/delivery-zones']) {
      const response = await callEndpoint(path)
      expect(response.status, path).toBe(200)
      assertNoSentinel(path, await response.json())
    }

    if (pageSlugForSweep) {
      const pageResponse = await callEndpoint(
        '/public/pages/:slug',
        { slug: pageSlugForSweep },
        `/public/pages/${pageSlugForSweep}`,
      )
      expect(pageResponse.status).toBe(200)
      assertNoSentinel('/public/pages/:slug', await pageResponse.json())
    }

    const { docs: portfolioDocs } = await payload.find({ collection: 'portfolio', limit: 1, overrideAccess: true })
    if (portfolioDocs[0]?.slug) {
      const portfolioSlug = portfolioDocs[0].slug
      const portfolioResponse = await callEndpoint(
        '/public/portfolio/:slug',
        { slug: portfolioSlug },
        `/public/portfolio/${portfolioSlug}`,
      )
      expect(portfolioResponse.status).toBe(200)
      assertNoSentinel('/public/portfolio/:slug', await portfolioResponse.json())
    }

    const listResponse = await callEndpoint('/public/products')
    expect(listResponse.status).toBe(200)
    assertNoSentinel('/public/products', await listResponse.json())

    const config2 = await config
    const detailEndpoint = config2.endpoints?.find(
      (entry) => 'path' in entry && entry.path === '/public/products/:slug',
    )
    if (!detailEndpoint || !('handler' in detailEndpoint)) throw new Error('missing endpoint')
    const req = serviceRequest(READ_TOKEN, `http://localhost:3001/api/public/products/${sentinelProductSlug}`, {
      slug: sentinelProductSlug,
    })
    const detailResponse = await detailEndpoint.handler(req)
    expect(detailResponse.status).toBe(200)
    const body = (await detailResponse.json()) as { documents: { issuer: string | null }[] }
    const { documents, ...withoutDocuments } = body
    assertNoSentinel('/public/products/:slug (minus documents)', withoutDocuments)
    expect(documents.some((doc) => doc.issuer === SENTINEL.supplierName)).toBe(true)

    const shareResponse = await callEndpoint(
      '/public/share/:token',
      { token: sentinelShareLinkToken },
      `/public/share/${sentinelShareLinkToken}`,
    )
    expect(shareResponse.status).toBe(200)
    assertNoSentinel('/public/share/:token', await shareResponse.json())
  })

  it('Payload\'s built-in REST, called anonymously, never leaks a sentinel value', async () => {
    for (const slugSegments of [['products'], ['variants']]) {
      const response = await callBuiltInRestAnonymously(slugSegments)
      expect(response.status, slugSegments.join('/')).toBe(200)
      // documents[*].issuer legitimately carries the sentinel supplier name
      // here too (D19) — it isn't a DTO, so nothing strips it for us.
      assertNoSentinel(`/api/${slugSegments.join('/')}`, stripDocuments(await response.json()))
    }

    const ordersResponse = await callBuiltInRestAnonymously(['orders'])
    expect(ordersResponse.status).toBe(403)
    assertNoSentinel('/api/orders (403 body)', await ordersResponse.json())

    // T3.7/T3.8: both new collections are admin-only, same as orders.
    const customRequestsResponse = await callBuiltInRestAnonymously(['custom-requests'])
    expect(customRequestsResponse.status).toBe(403)
    assertNoSentinel('/api/custom-requests (403 body)', await customRequestsResponse.json())

    const shareLinksResponse = await callBuiltInRestAnonymously(['share-links'])
    expect(shareLinksResponse.status).toBe(403)
    assertNoSentinel('/api/share-links (403 body)', await shareLinksResponse.json())

    // site-settings is public-read, but ownerEmails/ownerPhones/
    // notifyCustomer/shareLinkTtlDays are field-access-protected (ADR 0005
    // layer 2) — this is the one built-in REST check with something to
    // actually leak.
    const settingsResponse = await callBuiltInRestAnonymously(['globals', 'site-settings'])
    expect(settingsResponse.status).toBe(200)
    const settingsBody = (await settingsResponse.json()) as Record<string, unknown>
    assertNoSentinel('/api/globals/site-settings', settingsBody)
    expect(settingsBody.notifyCustomer).toBeUndefined()
    expect(settingsBody.shareLinkTtlDays).toBeUndefined()
  })
})
