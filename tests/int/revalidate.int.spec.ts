// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { notifyRevalidate } from '@/server/revalidate/notify'
import { runSeed, teardownSeed } from '../../scripts/seed'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload
const categoryIds: (number | string)[] = []
const productIds: (number | string)[] = []

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

describe('revalidation webhook (T1.11, ADR 0012 §5)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    for (const id of productIds.splice(0)) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds.splice(0)) {
      await payload.delete({ collection: 'categories', id }).catch(() => undefined)
    }
  })

  it('notifyRevalidate POSTs {tags} with the x-revalidate-secret header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await notifyRevalidate(payload, ['catalog'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(process.env.FRONTEND_REVALIDATE_URL)
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe(process.env.REVALIDATE_SECRET)
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog'] })
  })

  it('a frontend that is unreachable does not throw — the error is swallowed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(notifyRevalidate(payload, ['catalog'])).resolves.toBeUndefined()
  })

  it('context.disableRevalidate skips the request entirely', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await notifyRevalidate(payload, ['catalog'], { disableRevalidate: true })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saving a category (a real collection write) triggers exactly one revalidate request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const category = await payload.create({
      collection: 'categories',
      data: { name: `რევალიდაცია-ტესტი ${Date.now()}` },
    })
    categoryIds.push(category.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog'] })
  })

  // Code review fix: creating a product used to send *two* revalidate
  // requests — one from the product's own afterChange, one from the
  // default-variant it creates as a side effect (Variants has its own
  // ['catalog'] revalidate hook too). The criterion is exactly 1.
  it('saving a PRODUCT triggers exactly one revalidate request (not one per default variant)', async () => {
    // Created before the mock is installed — a category also has its own
    // ['catalog'] revalidate hook, and this test is specifically about the
    // product/variant double-fire, not the category's.
    const category = await payload.create({
      collection: 'categories',
      data: { name: `რევალიდაცია-პროდუქტის-კატ ${Date.now()}-${Math.random()}` },
    })
    categoryIds.push(category.id)

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const product = await payload.create({
      collection: 'products',
      data: {
        title: `რევალიდაციის-პროდუქტი ${Date.now()}-${Math.random()}`,
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
      },
    })
    productIds.push(product.id)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog'] })
  })

  it('the seed script never sends a revalidate request (context.disableRevalidate)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await runSeed(payload)

    expect(fetchMock).not.toHaveBeenCalled()

    // Other int test files share this same database — see seed.int.spec.ts.
    await teardownSeed(payload)
  })
})
