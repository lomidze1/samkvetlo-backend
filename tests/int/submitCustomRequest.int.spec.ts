// file-type's Uint8Array/Buffer instanceof checks need the real Node realm
// (same note as media.int.spec.ts).
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { submitCustomRequest } from '@/server/customRequests/submitCustomRequest'
import type { UploadedAttachment } from '@/server/customRequests/attachments'
import { customRequestsEndpoint } from '@/endpoints/public/customRequests'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let payload: Payload

const requestIds: (number | string)[] = []
const attachmentIds: (number | string)[] = []
const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []

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

async function createProduct(status: 'draft' | 'published') {
  const category = await payload.create({ collection: 'categories', data: { name: `მოთხ-კატ ${Date.now()}-${Math.random()}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `მოთხ-პროდ ${Date.now()}-${Math.random()}`,
      category: category.id,
      tier: 'standard',
      description: EMPTY_RICH_TEXT,
      _status: status,
    },
  })
  productIds.push(product.id)
  return product
}

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
async function loadFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, name))
}

function fakeReq(overrides: Partial<PayloadRequest>): PayloadRequest {
  return { payload, ...overrides } as unknown as PayloadRequest
}

// Cloudflare's well-known Turnstile test secrets (ADR 0012 §4).
const PASS_SECRET = '1x0000000000000000000000000000000AA'
const FAIL_SECRET = '2x0000000000000000000000000000000AA'

function baseInput(overrides: Partial<Parameters<typeof submitCustomRequest>[1]> = {}) {
  return {
    name: 'გიორგი',
    surname: 'ლომიძე',
    phone: '+995599123456',
    church: 'წმინდა გიორგის ეკლესია',
    category: 'other' as const,
    description: 'გთხოვთ დაამზადოთ კანკელი.',
    submissionId: randomUUID(),
    turnstileToken: 'test-token',
    ...overrides,
  } as Parameters<typeof submitCustomRequest>[1]
}

async function trackRequestAttachments(number: string): Promise<void> {
  const { docs } = await payload.find({
    collection: 'custom-requests',
    where: { number: { equals: number } },
    overrideAccess: true,
  })
  const doc = docs[0]
  if (!doc) return
  requestIds.push(doc.id)
  for (const attachment of doc.attachments ?? []) {
    attachmentIds.push(typeof attachment === 'object' ? attachment.id : attachment)
  }
}

describe('submitCustomRequest (T3.7, ADR 0011 §3 + ADR 0003 §4 pipeline order)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = PASS_SECRET
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { secret?: string }
      return new Response(JSON.stringify({ success: body.secret === PASS_SECRET }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    for (const id of requestIds) {
      await payload.delete({ collection: 'custom-requests', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of attachmentIds) {
      await payload.delete({ collection: 'private-files', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of categoryIds) {
      await payload.delete({ collection: 'categories', id, overrideAccess: true }).catch(() => undefined)
    }
  })

  it('(1) creates a request with status=new and a REQ-YYYY-000123 number', async () => {
    const result = await submitCustomRequest(payload, baseInput(), [], {
      ipHash: 'cr-ip-1',
      clientIp: '1.2.3.4',
    })
    expect(result.number).toMatch(/^REQ-\d{4}-\d{6}$/)
    await trackRequestAttachments(result.number)

    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, overrideAccess: true })
    ).docs[0]!
    expect(doc.status).toBe('new')
    expect(doc.category).toBe('other')
  })

  it('(2) a repeated submissionId returns the same number, creates only one row, and does not call Turnstile again', async () => {
    const input = baseInput()
    const ctx = { ipHash: 'cr-ip-2', clientIp: '1.2.3.4' }
    const turnstileCallCount = () =>
      fetchMock.mock.calls.filter(([url]) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify').length

    const first = await submitCustomRequest(payload, input, [], ctx)
    await trackRequestAttachments(first.number)
    expect(turnstileCallCount()).toBe(1)

    const second = await submitCustomRequest(payload, input, [], ctx)
    expect(second.number).toBe(first.number)
    expect(turnstileCallCount()).toBe(1)

    const { totalDocs } = await payload.count({
      collection: 'custom-requests',
      where: { submissionId: { equals: input.submissionId } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(1)
  })

  it('(3) a 6th request within 10 minutes from the same ipHash is rate-limited (429 err.rateLimited)', async () => {
    const ipHash = 'cr-ip-3'
    for (let i = 0; i < 5; i += 1) {
      const result = await submitCustomRequest(payload, baseInput(), [], { ipHash, clientIp: '5.6.7.8' })
      await trackRequestAttachments(result.number)
    }

    await expect(
      submitCustomRequest(payload, baseInput(), [], { ipHash, clientIp: '5.6.7.8' }),
    ).rejects.toMatchObject({ status: 429, code: 'err.rateLimited' })
  })

  it('(4) a failing Turnstile secret prevents the request from being created (403 err.turnstile)', async () => {
    process.env.TURNSTILE_SECRET_KEY = FAIL_SECRET
    const input = baseInput()

    await expect(
      submitCustomRequest(payload, input, [], { ipHash: 'cr-ip-4', clientIp: '9.9.9.9' }),
    ).rejects.toMatchObject({ status: 403, code: 'err.turnstile' })

    const { totalDocs } = await payload.count({
      collection: 'custom-requests',
      where: { submissionId: { equals: input.submissionId } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(0)
  })

  it('(5) attachments summing to more than 4 MB are rejected (413 err.attachments.tooLarge), and create no request', async () => {
    const bigJpeg = await loadFixture('product-3000x2000.jpg') // 856,582 bytes
    const files: UploadedAttachment[] = Array.from({ length: 5 }, (_, i) => ({
      data: bigJpeg,
      name: `big-${i}.jpg`,
    })) // 5 * 856,582 ≈ 4.28 MB > 4 MB, count (5) is still within the 5-file limit
    const input = baseInput()

    await expect(
      submitCustomRequest(payload, input, files, { ipHash: 'cr-ip-5', clientIp: '1.1.1.1' }),
    ).rejects.toMatchObject({ status: 413, code: 'err.attachments.tooLarge' })

    const { totalDocs } = await payload.count({
      collection: 'custom-requests',
      where: { submissionId: { equals: input.submissionId } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(0)
  })

  it('(6) an attachment whose magic bytes do not match any allowed type is rejected (415 err.attachments.invalidType)', async () => {
    const files: UploadedAttachment[] = [{ data: Buffer.from('plain text, not a real image or pdf'), name: 'note.jpg' }]
    const input = baseInput()

    await expect(
      submitCustomRequest(payload, input, files, { ipHash: 'cr-ip-6', clientIp: '2.2.2.2' }),
    ).rejects.toMatchObject({ status: 415, code: 'err.attachments.invalidType' })

    const { totalDocs } = await payload.count({
      collection: 'custom-requests',
      where: { submissionId: { equals: input.submissionId } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(0)
  })

  it('(7) more than 5 attachments are rejected (400 err.attachments.tooMany)', async () => {
    const smallJpeg = await loadFixture('product-1000-narrow.jpg')
    const files: UploadedAttachment[] = Array.from({ length: 6 }, (_, i) => ({ data: smallJpeg, name: `small-${i}.jpg` }))
    const input = baseInput()

    await expect(
      submitCustomRequest(payload, input, files, { ipHash: 'cr-ip-7', clientIp: '3.3.3.3' }),
    ).rejects.toMatchObject({ status: 400, code: 'err.attachments.tooMany' })

    const { totalDocs } = await payload.count({
      collection: 'custom-requests',
      where: { submissionId: { equals: input.submissionId } },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(0)
  })

  it('(8) a valid attachment (PDF) is stored and linked from custom-requests.attachments', async () => {
    const pdf = await loadFixture('sample.pdf')
    const result = await submitCustomRequest(payload, baseInput(), [{ data: pdf, name: 'certificate.pdf' }], {
      ipHash: 'cr-ip-8',
      clientIp: '4.4.4.4',
    })
    await trackRequestAttachments(result.number)

    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, depth: 0, overrideAccess: true })
    ).docs[0]!
    expect(doc.attachments).toHaveLength(1)
  })

  it('(9) a READ-scoped token on POST /api/public/custom-requests is forbidden (403)', async () => {
    const response = await customRequestsEndpoint.handler(
      fakeReq({ headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_READ}` }) }),
    )
    expect(response.status).toBe(403)
  })

  it('(9b) a missing x-client-ip is rejected (400 err.clientIp.missing) — MAJOR 1', async () => {
    const response = await customRequestsEndpoint.handler(
      fakeReq({ headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_WRITE}` }) }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('err.clientIp.missing')
  })

  it('(10) a valid published-product slug links the request to that product', async () => {
    const product = await createProduct('published')
    const result = await submitCustomRequest(payload, baseInput({ product: product.slug! }), [], {
      ipHash: 'cr-ip-10',
      clientIp: '10.10.10.10',
    })
    await trackRequestAttachments(result.number)

    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, depth: 0, overrideAccess: true })
    ).docs[0]!
    expect(doc.product).toBe(product.id)
  })

  it('(11) an unknown product slug saves the request with no relationship and no error', async () => {
    const result = await submitCustomRequest(payload, baseInput({ product: 'no-such-product-slug-xyz' }), [], {
      ipHash: 'cr-ip-11',
      clientIp: '11.11.11.11',
    })
    await trackRequestAttachments(result.number)

    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, depth: 0, overrideAccess: true })
    ).docs[0]!
    expect(doc.product ?? null).toBeNull()
  })

  it('(12) a draft (unpublished) product slug saves the request with no relationship and no error', async () => {
    const draft = await createProduct('draft')
    const result = await submitCustomRequest(payload, baseInput({ product: draft.slug! }), [], {
      ipHash: 'cr-ip-12',
      clientIp: '12.12.12.12',
    })
    await trackRequestAttachments(result.number)

    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, depth: 0, overrideAccess: true })
    ).docs[0]!
    expect(doc.product ?? null).toBeNull()
  })

  it('(13) if the custom-requests create fails, its just-uploaded attachment is deleted (not orphaned) — MINOR 4', async () => {
    const pdf = await loadFixture('sample.pdf')
    const originalCreate = payload.create.bind(payload)
    const createdAttachmentIds: (number | string)[] = []
    const createSpy = vi.spyOn(payload, 'create').mockImplementation(async (args: Parameters<Payload['create']>[0]) => {
      if (args.collection === 'custom-requests') throw new Error('db down')
      const doc = await originalCreate(args)
      if (args.collection === 'private-files') createdAttachmentIds.push(doc.id)
      return doc
    })

    try {
      await expect(
        submitCustomRequest(payload, baseInput(), [{ data: pdf, name: 'certificate.pdf' }], {
          ipHash: 'cr-ip-13',
          clientIp: '13.13.13.13',
        }),
      ).rejects.toThrow('db down')
    } finally {
      createSpy.mockRestore()
    }

    expect(createdAttachmentIds).toHaveLength(1)
    await expect(
      payload.findByID({ collection: 'private-files', id: createdAttachmentIds[0]!, overrideAccess: true }),
    ).rejects.toBeTruthy()
  })

  it('(13b) if an attachment upload fails part-way, the files already written are deleted — review follow-up', async () => {
    const pdf = await loadFixture('sample.pdf')
    const originalCreate = payload.create.bind(payload)
    const createdAttachmentIds: (number | string)[] = []
    let privateFileCreates = 0
    const createSpy = vi.spyOn(payload, 'create').mockImplementation(async (args: Parameters<Payload['create']>[0]) => {
      if (args.collection === 'private-files') {
        privateFileCreates += 1
        if (privateFileCreates === 2) throw new Error('storage down')
        const doc = await originalCreate(args)
        createdAttachmentIds.push(doc.id)
        return doc
      }
      return originalCreate(args)
    })

    try {
      await expect(
        submitCustomRequest(
          payload,
          baseInput(),
          [
            { data: pdf, name: 'first.pdf' },
            { data: pdf, name: 'second.pdf' },
          ],
          { ipHash: 'cr-ip-13b', clientIp: '13.13.13.14' },
        ),
      ).rejects.toThrow('storage down')
    } finally {
      createSpy.mockRestore()
    }

    expect(createdAttachmentIds).toHaveLength(1)
    await expect(
      payload.findByID({ collection: 'private-files', id: createdAttachmentIds[0]!, overrideAccess: true }),
    ).rejects.toBeTruthy()
  })

  it('(13c) a failing product lookup happens before any attachment is written — review follow-up', async () => {
    const pdf = await loadFixture('sample.pdf')
    const originalFind = payload.find.bind(payload)
    const findSpy = vi.spyOn(payload, 'find').mockImplementation(async (args: Parameters<Payload['find']>[0]) => {
      if (args.collection === 'products') throw new Error('products lookup down')
      return originalFind(args)
    })
    const createSpy = vi.spyOn(payload, 'create')

    try {
      await expect(
        submitCustomRequest(payload, baseInput({ product: 'any-slug' }), [{ data: pdf, name: 'certificate.pdf' }], {
          ipHash: 'cr-ip-13c',
          clientIp: '13.13.13.15',
        }),
      ).rejects.toThrow('products lookup down')
      const privateFileCreates = createSpy.mock.calls.filter(([args]) => args.collection === 'private-files')
      expect(privateFileCreates).toHaveLength(0)
    } finally {
      findSpy.mockRestore()
      createSpy.mockRestore()
    }
  })

  it('(14) a throwing notification step (findGlobal) still returns the request number — MINOR 3', async () => {
    const findGlobalSpy = vi.spyOn(payload, 'findGlobal').mockRejectedValueOnce(new Error('site-settings unavailable'))

    let result: Awaited<ReturnType<typeof submitCustomRequest>>
    try {
      result = await submitCustomRequest(payload, baseInput(), [], { ipHash: 'cr-ip-13', clientIp: '13.13.13.13' })
    } finally {
      findGlobalSpy.mockRestore()
    }
    await trackRequestAttachments(result.number)

    expect(result.number).toMatch(/^REQ-\d{4}-\d{6}$/)
    const doc = (
      await payload.find({ collection: 'custom-requests', where: { number: { equals: result.number } }, depth: 0, overrideAccess: true })
    ).docs[0]!
    expect(doc.notifications ?? []).toHaveLength(0)
  })
})
