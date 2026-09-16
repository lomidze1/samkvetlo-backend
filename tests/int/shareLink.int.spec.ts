// @vitest-environment node
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { createShareLink } from '@/server/share/createShareLink'
import { revokeShareLink } from '@/server/share/revokeShareLink'
import { getPublicShareByToken } from '@/server/public/share'
import { shareLinkCreateEndpoint, shareLinkRevokeEndpoint } from '@/endpoints/public/shareLinks'
import { approvePriceEndpoint } from '@/endpoints/approvePrice'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const userIds: (number | string)[] = []
const rateIds: (number | string)[] = []
const shareLinkIds: (number | string)[] = []
let counter = 0

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
        children: [
          { type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const },
        ],
      },
    ],
  },
}

function fakeReq(overrides: Partial<PayloadRequest>): PayloadRequest {
  return { payload, ...overrides } as unknown as PayloadRequest
}

async function createAdmin() {
  counter += 1
  const admin = await payload.create({
    collection: 'users',
    data: { email: `share-link-admin-${counter}@samkvetlo.local`, password: 'test-password' },
  })
  userIds.push(admin.id)
  return admin
}

async function createRate() {
  counter += 1
  const rate = await payload.create({
    collection: 'exchange-rates',
    data: { date: new Date(2026, 1, counter).toISOString(), rubGel: 0.03, usdGel: 2.6, source: 'test' },
  })
  rateIds.push(rate.id)
  return rate
}

async function createPurchasableVariant(): Promise<number> {
  await createRate()
  counter += 1
  const category = await payload.create({ collection: 'categories', data: { name: `share-link-კატ ${counter}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `share-link-პროდუქტი ${counter}`,
      category: category.id,
      tier: 'standard',
      description: EMPTY_RICH_TEXT,
      _status: 'published',
    },
  })
  productIds.push(product.id)

  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  const variant = variants[0]!

  const costing = await payload.create({
    collection: 'costings',
    data: { variant: variant.id, costRub: 300_000, logisticsGel: 0 },
  })
  const admin = await createAdmin()
  const response = await approvePriceEndpoint.handler(
    fakeReq({ user: admin, routeParams: { id: String(costing.id) }, data: { price: costing.suggestedPriceGel } }),
  )
  expect(response.status).toBe(200)

  return variant.id
}

async function findShareLinkIdByTokenHint(token: string): Promise<number | string> {
  // Test-only lookup, mirroring src/server/public/share.ts's own hashToken use.
  const { hashToken } = await import('@/server/share/token')
  const { docs } = await payload.find({
    collection: 'share-links',
    where: { tokenHash: { equals: hashToken(token) } },
    overrideAccess: true,
  })
  return docs[0]!.id
}

describe('share-links (T3.8, ADR 0011 §1, ADR 0014 §2/§13)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of shareLinkIds) await payload.delete({ collection: 'share-links', id, overrideAccess: true }).catch(() => undefined)
    for (const id of productIds) {
      const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: id } }, depth: 0 })
      for (const variant of variants) {
        await payload.delete({ collection: 'costings', where: { variant: { equals: variant.id } } }).catch(() => undefined)
      }
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
    for (const id of userIds) await payload.delete({ collection: 'users', id }).catch(() => undefined)
    for (const id of rateIds) await payload.delete({ collection: 'exchange-rates', id }).catch(() => undefined)
  })

  it('(1) a token is 43 chars, and only its sha256 hash is stored in the DB', async () => {
    const variantId = await createPurchasableVariant()
    const result = await createShareLink(
      payload,
      { kind: 'cart', cartLines: [{ variantId, qty: 2 }] },
      { ipHash: 'share-ip-1' },
    )
    const id = await findShareLinkIdByTokenHint(result.token)
    shareLinkIds.push(id)

    expect(result.token).toHaveLength(43)
    expect(result.ownerSecret.length).toBeGreaterThan(0)

    const doc = await payload.findByID({ collection: 'share-links', id, overrideAccess: true })
    expect(doc.tokenHash).not.toBe(result.token)
    expect(JSON.stringify(doc)).not.toContain(result.token)
    expect(JSON.stringify(doc)).not.toContain(result.ownerSecret)
  })

  it('(2) GET returns the cart lines with current public prices; kind is "cart"', async () => {
    const variantId = await createPurchasableVariant()
    const variant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })
    const result = await createShareLink(
      payload,
      { kind: 'cart', cartLines: [{ variantId, qty: 3 }] },
      { ipHash: 'share-ip-2' },
    )
    shareLinkIds.push(await findShareLinkIdByTokenHint(result.token))

    const dto = await getPublicShareByToken(payload, result.token)
    expect(dto).toBeTruthy()
    expect(dto!.kind).toBe('cart')
    expect(dto!.lines).toHaveLength(1)
    expect(dto!.lines[0]).toMatchObject({ variantId, qty: 3, unitPrice: variant.price, available: true })
    expect(dto!.itemsTotalGel).toBe((variant.price as number) * 3)
  })

  it('(3) an unknown token, an expired token and a revoked token all resolve to the identical null (-> 404)', async () => {
    const variantId = await createPurchasableVariant()

    const unknown = await getPublicShareByToken(payload, 'unknown-token-that-was-never-issued-000000000')
    expect(unknown).toBeNull()

    const expiredResult = await createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash: 'share-ip-3a' })
    const expiredId = await findShareLinkIdByTokenHint(expiredResult.token)
    shareLinkIds.push(expiredId)
    await payload.update({
      collection: 'share-links',
      id: expiredId,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    })
    expect(await getPublicShareByToken(payload, expiredResult.token)).toBeNull()

    const revokedResult = await createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash: 'share-ip-3b' })
    shareLinkIds.push(await findShareLinkIdByTokenHint(revokedResult.token))
    await revokeShareLink(payload, { token: revokedResult.token, ownerSecret: revokedResult.ownerSecret })
    expect(await getPublicShareByToken(payload, revokedResult.token)).toBeNull()
  })

  it('(4) revoke without ownerSecret, or with the wrong one, is 403 and does not revoke the link', async () => {
    const variantId = await createPurchasableVariant()
    const result = await createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash: 'share-ip-4' })
    shareLinkIds.push(await findShareLinkIdByTokenHint(result.token))

    await expect(
      revokeShareLink(payload, { token: result.token } as Parameters<typeof revokeShareLink>[1]),
    ).rejects.toMatchObject({ status: 403, code: 'err.shareLink.forbidden' })

    await expect(
      revokeShareLink(payload, { token: result.token, ownerSecret: 'wrong-secret' }),
    ).rejects.toMatchObject({ status: 403, code: 'err.shareLink.forbidden' })

    // still live
    expect(await getPublicShareByToken(payload, result.token)).toBeTruthy()
  })

  it('(5) revoke with the correct ownerSecret is idempotent and the link then 404s', async () => {
    const variantId = await createPurchasableVariant()
    const result = await createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash: 'share-ip-5' })
    shareLinkIds.push(await findShareLinkIdByTokenHint(result.token))

    const first = await revokeShareLink(payload, { token: result.token, ownerSecret: result.ownerSecret })
    expect(first).toEqual({ ok: true })
    const second = await revokeShareLink(payload, { token: result.token, ownerSecret: result.ownerSecret })
    expect(second).toEqual({ ok: true })

    expect(await getPublicShareByToken(payload, result.token)).toBeNull()
  })

  it('(6) a 21st share-link within 10 minutes from the same ipHash is rate-limited (429 err.rateLimited)', async () => {
    const variantId = await createPurchasableVariant()
    const ipHash = 'share-ip-6'
    for (let i = 0; i < 20; i += 1) {
      const result = await createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash })
      shareLinkIds.push(await findShareLinkIdByTokenHint(result.token))
    }

    await expect(
      createShareLink(payload, { kind: 'cart', cartLines: [{ variantId, qty: 1 }] }, { ipHash }),
    ).rejects.toMatchObject({ status: 429, code: 'err.rateLimited' })
  })

  it('(7) a READ-scoped token is forbidden (403) on both write endpoints', async () => {
    const readAuth = { headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_READ}` }) }
    expect((await shareLinkCreateEndpoint.handler(fakeReq(readAuth))).status).toBe(403)
    expect((await shareLinkRevokeEndpoint.handler(fakeReq(readAuth))).status).toBe(403)
  })

  it('(8) a missing x-client-ip on create is rejected (400 err.clientIp.missing) — MAJOR 1', async () => {
    const writeAuth = fakeReq({ headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_WRITE}` }) })
    const response = await shareLinkCreateEndpoint.handler(writeAuth)
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('err.clientIp.missing')
  })
})
