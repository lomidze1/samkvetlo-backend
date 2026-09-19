// ADR 0014 §12 (D25) / T5.12: retention cron + anonymization. Real Postgres
// (not mocked) — `createdAt`/`statusChangedAt`/`expiresAt` are set directly
// at create time (Payload respects an explicit value for these on create),
// so each fixture's "age" is exact and doesn't need fake timers.
// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PayloadRequest } from 'payload'
import { getPayload, type Payload } from 'payload'

import { cronRetentionEndpoint } from '@/endpoints/cronRetention'
import config from '@/payload.config'
import { memoryEmailSender } from '@/server/notify/memoryAdapter'
import { runRetention } from '@/server/retention/run'
import type { CustomRequest, Order } from '@/payload-types'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above the static imports above, so the factory can't
// close over a plain top-level const (temporal dead zone) — vi.hoisted
// gives it a binding that exists by the time the factory runs. Same
// pattern as ratesRecompute.int.spec.ts's own Sentry mock.
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureMessage }))

let payload: Payload

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
async function loadFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, name))
}

const orderIds: (number | string)[] = []
const requestIds: (number | string)[] = []
const attachmentIds: (number | string)[] = []
const shareLinkIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const productIds: (number | string)[] = []
let counter = 0

const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const OWNER_EMAIL = 'owner-retention@samkvetlo.local'

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

async function createVariant(): Promise<{ productId: number; variantId: number }> {
  counter += 1
  const unique = `${counter}-${Date.now()}-${Math.random()}`
  const category = await payload.create({ collection: 'categories', data: { name: `retention-cat ${unique}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: { title: `retention-product ${unique}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
  })
  productIds.push(product.id)
  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  return { productId: product.id, variantId: variants[0]!.id }
}

interface CreateOrderOptions {
  status?: Order['status']
  statusChangedAt: string
  patriarchateLetterFileId?: number
}

async function createOrder({ status = 'delivered', statusChangedAt, patriarchateLetterFileId }: CreateOrderOptions): Promise<Order> {
  counter += 1
  const { variantId } = await createVariant()
  const order = await payload.create({
    collection: 'orders',
    data: {
      submissionId: `retention-sub-${counter}-${Date.now()}`,
      name: 'გიორგი',
      surname: 'ლომიძე',
      phone: '+995599123456',
      church: 'წმინდა გიორგის ეკლესია',
      city: 'თბილისი',
      email: 'giorgi@example.com',
      comment: 'გთხოვთ დარეკოთ საღამოს',
      items: [
        {
          variant: variantId,
          productTitle: 'ზარი',
          variantTitle: 'სტანდარტული',
          sku: 'SMK-000001',
          unitPrice: 1000,
          qty: 2,
          patriarchateLetter: patriarchateLetterFileId ? { received: true, file: patriarchateLetterFileId } : undefined,
        },
      ],
      deliveryZone: { slug: 'kakheti', name: 'კახეთი' },
      deliveryFeeGel: 200,
      payment: { amountGel: 2200, receivedBy: 'გ.ლ.' },
      status,
      statusChangedAt,
    },
    overrideAccess: true,
  })
  orderIds.push(order.id)
  return order
}

async function createCustomRequest(statusChangedAt: string, attachmentId?: number): Promise<CustomRequest> {
  counter += 1
  const request = await payload.create({
    collection: 'custom-requests',
    data: {
      submissionId: `retention-cr-sub-${counter}-${Date.now()}`,
      name: 'ნინო',
      surname: 'ნინოშვილი',
      phone: '+995599111111',
      church: 'სამების ტაძარი',
      email: 'nino@example.com',
      category: 'other',
      description: 'გთხოვთ დამიმზადოთ ხატი',
      attachments: attachmentId ? [attachmentId] : undefined,
      status: 'lost',
      statusChangedAt,
    },
    overrideAccess: true,
  })
  requestIds.push(request.id)
  return request
}

describe('retention (T5.12, ADR 0014 §12)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  beforeEach(async () => {
    process.env.EMAIL_ADAPTER = 'memory'
    memoryEmailSender.reset()
    captureMessage.mockClear()
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { retentionYears: 2, ownerEmails: [{ email: OWNER_EMAIL }] },
      overrideAccess: true,
    })
  })

  afterEach(async () => {
    for (const id of shareLinkIds.splice(0)) {
      await payload.delete({ collection: 'share-links', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of orderIds.splice(0)) {
      await payload.delete({ collection: 'orders', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of requestIds.splice(0)) {
      await payload.delete({ collection: 'custom-requests', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of attachmentIds.splice(0)) {
      await payload.delete({ collection: 'private-files', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of productIds.splice(0)) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of categoryIds.splice(0)) {
      await payload.delete({ collection: 'categories', id, overrideAccess: true }).catch(() => undefined)
    }
    await payload.updateGlobal({ slug: 'site-settings', data: { ownerEmails: [] }, overrideAccess: true })
  })

  afterAll(async () => {
    delete process.env.EMAIL_ADAPTER
  })

  describe('GET /api/cron/retention auth', () => {
    const ORIGINAL_SECRET = process.env.CRON_SECRET
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-cron-secret'
    })
    afterEach(() => {
      process.env.CRON_SECRET = ORIGINAL_SECRET
    })

    it('without a bearer token returns 401', async () => {
      const response = await cronRetentionEndpoint.handler({ headers: new Headers() } as unknown as PayloadRequest)
      expect(response.status).toBe(401)
    })

    it('with the wrong bearer token returns 401', async () => {
      const response = await cronRetentionEndpoint.handler({
        headers: new Headers({ authorization: 'Bearer wrong' }),
      } as unknown as PayloadRequest)
      expect(response.status).toBe(401)
    })
  })

  describe('order anonymization', () => {
    it('delivered, statusChangedAt = 2 years + 1 day ago -> PII fields blanked, everything else untouched', async () => {
      const letter = await payload.create({
        collection: 'private-files',
        data: {},
        file: { data: await loadFixture('sample.pdf'), mimetype: 'application/pdf', name: 'letter.pdf', size: (await loadFixture('sample.pdf')).length },
        overrideAccess: true,
      })
      attachmentIds.push(letter.id)

      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const order = await createOrder({ status: 'delivered', statusChangedAt, patriarchateLetterFileId: letter.id })

      const result = await runRetention(payload)
      expect(result.ordersAnonymized).toBeGreaterThanOrEqual(1)

      const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      expect(reloaded.name).toBe('—')
      expect(reloaded.surname).toBe('—')
      expect(reloaded.phone).toBe('—')
      expect(reloaded.church).toBe('—')
      expect(reloaded.email).toBeFalsy()
      expect(reloaded.comment).toBeFalsy()
      expect(reloaded.anonymizedAt).toBeTruthy()

      // Untouched.
      expect(reloaded.number).toBe(order.number)
      expect(reloaded.items).toHaveLength(1)
      expect(reloaded.items[0]!.sku).toBe('SMK-000001')
      expect(reloaded.items[0]!.qty).toBe(2)
      expect(reloaded.itemsTotalGel).toBe(order.itemsTotalGel)
      expect(reloaded.deliveryZone).toEqual(order.deliveryZone)
      expect(reloaded.deliveryFeeGel).toBe(order.deliveryFeeGel)
      expect(reloaded.totalGel).toBe(order.totalGel)
      expect(reloaded.city).toBe('თბილისი')
      expect(reloaded.payment).toEqual(order.payment)
      expect(reloaded.statusHistory ?? []).toHaveLength((order.statusHistory ?? []).length)
      expect((reloaded.items[0]!.patriarchateLetter?.file as number | undefined) ?? reloaded.items[0]!.patriarchateLetter?.file).toBeTruthy()
    })

    it('delivered, statusChangedAt = 2 years - 1 day ago -> untouched', async () => {
      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS + DAY_MS).toISOString()
      const order = await createOrder({ status: 'delivered', statusChangedAt })

      await runRetention(payload)

      const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      expect(reloaded.name).toBe('გიორგი')
      expect(reloaded.anonymizedAt).toBeFalsy()
    })

    it('paid, 3 years old -> untouched, and listed in the owner digest email', async () => {
      const statusChangedAt = new Date(Date.now() - 3 * YEAR_MS).toISOString()
      const order = await createOrder({ status: 'paid', statusChangedAt })

      const result = await runRetention(payload)
      expect(result.ordersSkippedOpen).toBeGreaterThanOrEqual(1)

      const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      expect(reloaded.name).toBe('გიორგი')
      expect(reloaded.anonymizedAt).toBeFalsy()

      expect(memoryEmailSender.sent.length).toBeGreaterThanOrEqual(1)
      const digest = memoryEmailSender.sent.find((email) => email.to.includes(OWNER_EMAIL))
      expect(digest).toBeTruthy()
      expect(digest!.text).toContain(order.number)
    })

    // M11 review fix (low): a real adapter failure sending the digest must
    // not throw out of runRetention — the anonymization work above it
    // already ran and committed. Same pattern/assertions as
    // ratesRecompute.int.spec.ts's own "an email sender failure does not
    // throw" test.
    it('a digest email sender failure does not throw — Sentry gets name/code only, no PII', async () => {
      const providerError = Object.assign(new Error('ProviderError: rate_limit_exceeded (someone@example.com)'), {
        name: 'ProviderError',
        code: 'rate_limit_exceeded',
      })
      const sendSpy = vi.spyOn(memoryEmailSender, 'send').mockRejectedValueOnce(providerError)

      const statusChangedAt = new Date(Date.now() - 3 * YEAR_MS).toISOString()
      await createOrder({ status: 'paid', statusChangedAt })

      try {
        const result = await runRetention(payload)
        expect(result.ordersSkippedOpen).toBeGreaterThanOrEqual(1)

        expect(captureMessage).toHaveBeenCalledTimes(1)
        const [message, args] = captureMessage.mock.calls[0]!
        expect(message).toBe('notification failed: email')
        expect(args).toEqual({ level: 'warning', extra: { channel: 'email', name: 'ProviderError', code: 'rate_limit_exceeded' } })
        expect(JSON.stringify(args)).not.toContain('someone@example.com')
      } finally {
        sendSpy.mockRestore()
      }
    })

    it('a second run is idempotent — no error, no double-processing', async () => {
      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const order = await createOrder({ status: 'delivered', statusChangedAt })

      await runRetention(payload)
      const afterFirst = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      const anonymizedAtAfterFirst = afterFirst.anonymizedAt

      const result = await runRetention(payload)
      const afterSecond = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })

      expect(afterSecond.anonymizedAt).toBe(anonymizedAtAfterFirst)
      expect(afterSecond.name).toBe('—')
      // The already-anonymized order must not be counted or reprocessed again.
      expect(result.ordersAnonymized).toBe(0)
    })

    it('anonymization does not add a statusHistory entry', async () => {
      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const order = await createOrder({ status: 'delivered', statusChangedAt })
      const historyLengthBefore = (order.statusHistory ?? []).length

      await runRetention(payload)

      const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      expect((reloaded.statusHistory ?? []).length).toBe(historyLengthBefore)
    })

    // Code review finding: sendAndReport.ts can write a raw provider error
    // (echoing the recipient) into notifications[].error — anonymization
    // must blank it, not just the top-level name/phone/email fields.
    it('blanks notifications[].error (may contain the recipient), keeps channel/status/at', async () => {
      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const order = await createOrder({ status: 'delivered', statusChangedAt })
      await payload.update({
        collection: 'orders',
        id: order.id,
        data: {
          notifications: [
            { channel: 'email', status: 'failed', error: "Invalid 'to' field: giorgi@example.com", at: new Date().toISOString() },
            { channel: 'sms', status: 'sent', at: new Date().toISOString() },
          ],
        },
        overrideAccess: true,
      })

      await runRetention(payload)

      const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true, depth: 0 })
      const notifications = reloaded.notifications ?? []
      expect(notifications).toHaveLength(2)
      expect(notifications[0]!.error).toBeFalsy()
      expect(notifications[0]!.channel).toBe('email')
      expect(notifications[0]!.status).toBe('failed')
      expect(notifications[1]!.status).toBe('sent')
    })
  })

  describe('custom-request anonymization', () => {
    it('lost, statusChangedAt = 2 years + 1 day ago -> anonymized, attachments deleted', async () => {
      const attachment = await payload.create({
        collection: 'private-files',
        data: {},
        file: { data: await loadFixture('product-3000x2000.jpg'), mimetype: 'image/jpeg', name: 'sketch.jpg', size: (await loadFixture('product-3000x2000.jpg')).length },
        overrideAccess: true,
      })
      attachmentIds.push(attachment.id)

      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const request = await createCustomRequest(statusChangedAt, attachment.id)

      const result = await runRetention(payload)
      expect(result.customRequestsAnonymized).toBeGreaterThanOrEqual(1)

      const reloaded = await payload.findByID({ collection: 'custom-requests', id: request.id, overrideAccess: true, depth: 0 })
      expect(reloaded.name).toBe('—')
      expect(reloaded.description).toBe('—')
      expect(reloaded.email).toBeFalsy()
      expect(reloaded.attachments ?? []).toHaveLength(0)
      expect(reloaded.anonymizedAt).toBeTruthy()
      expect(reloaded.number).toBe(request.number)

      await expect(
        payload.findByID({ collection: 'private-files', id: attachment.id, overrideAccess: true }),
      ).rejects.toThrow()
      attachmentIds.length = 0 // already gone
    })

    // Code review finding: a failed attachment delete (e.g. a transient
    // storage error) must not be swallowed into `attachments: []` — the
    // failed id stays on the request and anonymizedAt stays unset, so the
    // next cron run retries just that attachment.
    it('a failed attachment delete keeps the id and anonymizedAt unset; a later run retries and completes', async () => {
      const attachment = await payload.create({
        collection: 'private-files',
        data: {},
        file: {
          data: await loadFixture('product-3000x2000.jpg'),
          mimetype: 'image/jpeg',
          name: 'sketch-retry.jpg',
          size: (await loadFixture('product-3000x2000.jpg')).length,
        },
        overrideAccess: true,
      })
      attachmentIds.push(attachment.id)

      const statusChangedAt = new Date(Date.now() - 2 * YEAR_MS - DAY_MS).toISOString()
      const request = await createCustomRequest(statusChangedAt, attachment.id)

      const deleteSpy = vi.spyOn(payload, 'delete').mockImplementationOnce(() => {
        throw new Error('storage unavailable')
      })

      const firstResult = await runRetention(payload)
      expect(firstResult.customRequestsAnonymized).toBe(0)
      deleteSpy.mockRestore()

      const afterFirstRun = await payload.findByID({ collection: 'custom-requests', id: request.id, overrideAccess: true, depth: 0 })
      expect(afterFirstRun.anonymizedAt).toBeFalsy()
      expect((afterFirstRun.attachments ?? []).length).toBe(1)
      // PII is already blanked even though the record isn't "done" yet —
      // re-blanking on the retry run is idempotent.
      expect(afterFirstRun.name).toBe('—')

      const secondResult = await runRetention(payload)
      expect(secondResult.customRequestsAnonymized).toBeGreaterThanOrEqual(1)

      const afterSecondRun = await payload.findByID({ collection: 'custom-requests', id: request.id, overrideAccess: true, depth: 0 })
      expect(afterSecondRun.anonymizedAt).toBeTruthy()
      expect(afterSecondRun.attachments ?? []).toHaveLength(0)

      await expect(
        payload.findByID({ collection: 'private-files', id: attachment.id, overrideAccess: true }),
      ).rejects.toThrow()
      attachmentIds.length = 0 // already gone
    })
  })

  describe('ipHash retention (30 days)', () => {
    it('clears ipHash older than 30 days, leaves a recent one alone', async () => {
      const old = await createOrder({ statusChangedAt: new Date().toISOString() })
      await payload.update({ collection: 'orders', id: old.id, data: { ipHash: 'old-hash' }, overrideAccess: true })
      await payload.db.updateOne({ collection: 'orders', id: old.id, data: { createdAt: new Date(Date.now() - 31 * DAY_MS).toISOString() } })

      const recent = await createOrder({ statusChangedAt: new Date().toISOString() })
      await payload.update({ collection: 'orders', id: recent.id, data: { ipHash: 'recent-hash' }, overrideAccess: true })

      const result = await runRetention(payload)
      expect(result.ipHashCleared).toBeGreaterThanOrEqual(1)

      const reloadedOld = await payload.findByID({ collection: 'orders', id: old.id, overrideAccess: true, depth: 0 })
      const reloadedRecent = await payload.findByID({ collection: 'orders', id: recent.id, overrideAccess: true, depth: 0 })
      expect(reloadedOld.ipHash).toBeFalsy()
      expect(reloadedRecent.ipHash).toBe('recent-hash')
    })
  })

  describe('share-links (expiresAt + 30 days)', () => {
    async function createShareLink(expiresAt: string) {
      const link = await payload.create({
        collection: 'share-links',
        data: { kind: 'cart', tokenHash: `hash-${Date.now()}-${Math.random()}`, ownerSecretHash: 'secret-hash', expiresAt },
        overrideAccess: true,
      })
      shareLinkIds.push(link.id)
      return link
    }

    it('deletes a link expired 31 days ago, keeps one expired 29 days ago', async () => {
      const old = await createShareLink(new Date(Date.now() - 31 * DAY_MS).toISOString())
      const recent = await createShareLink(new Date(Date.now() - 29 * DAY_MS).toISOString())

      const result = await runRetention(payload)
      expect(result.shareLinksDeleted).toBeGreaterThanOrEqual(1)

      await expect(payload.findByID({ collection: 'share-links', id: old.id, overrideAccess: true })).rejects.toThrow()
      await expect(payload.findByID({ collection: 'share-links', id: recent.id, overrideAccess: true })).resolves.toBeTruthy()
      shareLinkIds.splice(shareLinkIds.indexOf(old.id), 1)
    })
  })
})
