// ADR 0005 (supplier-data secrecy) T1 + T2, run against SEED_SENTINEL=1
// (tests/fixtures/sentinel.ts). This is the CI merge gate — see T1.10.
// @vitest-environment node
import { getPayload, type AccessArgs, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Suppliers } from '@/collections/Suppliers'
import { Costings } from '@/collections/Costings'
import { Orders } from '@/collections/Orders'
import { PrivateFiles } from '@/collections/PrivateFiles'
import { ExchangeRates } from '@/collections/ExchangeRates'

import { getPublicCategories } from '@/server/public/category'
import { getPublicSiteSettings } from '@/server/public/siteSettings'
import { getPublicProductCards, getPublicProductBySlug } from '@/server/public/product'
import { getPublicPortfolio, getPublicPortfolioBySlug } from '@/server/public/portfolio'
import { getPublicDeliveryZones } from '@/server/public/deliveryZones'

import { runSeed, teardownSeed } from '../../scripts/seed'
import { SENTINEL } from '../fixtures/sentinel'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let sentinelProductSlug: string
const cleanupIds: { collection: 'categories' | 'products' | 'public-files'; id: number | string }[] = []

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
async function createSentinelProduct(): Promise<string> {
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

  return product.slug!
}

const SENTINEL_PATTERN = /ZZSENT|987654/

function assertNoSentinel(label: string, value: unknown): void {
  expect(JSON.stringify(value), label).not.toMatch(SENTINEL_PATTERN)
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

async function callEndpoint(path: string, routeParams?: Record<string, string>): Promise<Response> {
  const config2 = await config
  const endpoint = config2.endpoints?.find((entry) => 'path' in entry && entry.path === path)
  if (!endpoint || !('handler' in endpoint)) throw new Error(`endpoint not found: ${path}`)
  const req = serviceRequest(READ_TOKEN, `http://localhost:3001/api${path}`, routeParams)
  return endpoint.handler(req)
}

describe('supplier-data secrecy (ADR 0005) — T1 unit', () => {
  it('suppliers/costings/orders/private-files/exchange-rates deny an anonymous read', async () => {
    expect(await Suppliers.access!.read!(anonymousAccess)).toBe(false)
    expect(await Costings.access!.read!(anonymousAccess)).toBe(false)
    expect(await Orders.access!.read!(anonymousAccess)).toBe(false)
    expect(await PrivateFiles.access!.read!(anonymousAccess)).toBe(false)
    expect(await ExchangeRates.access!.read!(anonymousAccess)).toBe(false)
  })
})

describe('supplier-data secrecy (ADR 0005) — T2 integration (SEED_SENTINEL=1)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    process.env.SEED_SENTINEL = '1'
    await runSeed(payload)
    sentinelProductSlug = await createSentinelProduct()
  })

  afterAll(async () => {
    delete process.env.SEED_SENTINEL
    for (const { collection, id } of cleanupIds) {
      await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
    }
    // Other int test files share this same database — see seed.int.spec.ts.
    await teardownSeed(payload)
  })

  it('src/server/public/* exports never leak a sentinel value', async () => {
    assertNoSentinel('categories', await getPublicCategories(payload))
    assertNoSentinel('site-settings', await getPublicSiteSettings(payload))
    assertNoSentinel('delivery-zones', await getPublicDeliveryZones(payload))

    const cards = await getPublicProductCards(payload, {})
    assertNoSentinel('product cards', cards)

    const portfolio = await getPublicPortfolio(payload)
    assertNoSentinel('portfolio list', portfolio)
    if (portfolio[0]) {
      assertNoSentinel('portfolio item', await getPublicPortfolioBySlug(payload, portfolio[0].slug))
    }

    // D19 exception: documents[*].issuer legitimately carries the supplier
    // name — stripped before the blanket check, then checked positively (it
    // must be there, and *only* there).
    const sentinelProduct = await getPublicProductBySlug(payload, sentinelProductSlug)
    expect(sentinelProduct).toBeTruthy()
    const { documents, ...productWithoutDocuments } = sentinelProduct!
    assertNoSentinel('product detail (minus documents)', productWithoutDocuments)
    expect(documents.some((doc) => doc.issuer === SENTINEL.supplierName)).toBe(true)
    for (const doc of documents) {
      if (doc.issuer !== SENTINEL.supplierName) assertNoSentinel('document', doc)
    }
  })

  it('every /api/public/* endpoint (read token) never leaks a sentinel value', async () => {
    for (const path of ['/public/categories', '/public/site-settings', '/public/portfolio', '/public/delivery-zones']) {
      const response = await callEndpoint(path)
      expect(response.status, path).toBe(200)
      assertNoSentinel(path, await response.json())
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
  })
})
