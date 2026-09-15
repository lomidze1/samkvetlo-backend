// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { notifyRevalidate } from '@/server/revalidate/notify'
import { runSeed, teardownSeed } from '../../scripts/seed'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload
const categoryIds: (number | string)[] = []

describe('revalidation webhook (T1.11, ADR 0012 §5)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
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

  it('the seed script never sends a revalidate request (context.disableRevalidate)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await runSeed(payload)

    expect(fetchMock).not.toHaveBeenCalled()

    // Other int test files share this same database — see seed.int.spec.ts.
    await teardownSeed(payload)
  })
})
