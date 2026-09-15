// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { getPublicDeliveryZones } from '@/server/public/deliveryZones'
import { ka } from '@/i18n/ka'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload
const zoneIds: (number | string)[] = []

async function createZone(overrides: Partial<{ name: string; slug: string; feeGel: number; sortOrder: number; active: boolean }>) {
  const doc = await payload.create({
    collection: 'delivery-zones',
    data: { name: `ტესტ-ზონა ${Date.now()}-${Math.random()}`, feeGel: 100, ...overrides },
    overrideAccess: true,
  })
  zoneIds.push(doc.id)
  return doc
}

describe('delivery-zones collection (T1.13, ADR 0015)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    for (const id of zoneIds) await payload.delete({ collection: 'delivery-zones', id, overrideAccess: true }).catch(() => undefined)
  })

  it('feeGel 199.5 (fractional) is rejected', async () => {
    await expect(createZone({ feeGel: 199.5 })).rejects.toMatchObject({ status: 400 })
  })

  it('feeGel -1 (negative) is rejected', async () => {
    await expect(createZone({ feeGel: -1 })).rejects.toMatchObject({ status: 400 })
  })

  it('feeGel 200 is accepted', async () => {
    const zone = await createZone({ feeGel: 200 })
    expect(zone.feeGel).toBe(200)
  })

  it('two zones with the same slug violate the unique constraint', async () => {
    const slug = `dup-${Date.now()}`
    await createZone({ slug })
    await expect(createZone({ slug })).rejects.toBeTruthy()
  })

  it('"tbilisi" cannot be deleted', async () => {
    const { docs } = await payload.find({
      collection: 'delivery-zones',
      where: { slug: { equals: 'tbilisi' } },
      limit: 1,
      overrideAccess: true,
    })
    expect(docs[0]).toBeTruthy()
    await expect(
      payload.delete({ collection: 'delivery-zones', id: docs[0]!.id, overrideAccess: true }),
    ).rejects.toMatchObject({ status: 400, message: ka.server.deliveryZones.tbilisiCannotDelete })
  })

  it('"tbilisi" cannot be deactivated', async () => {
    const { docs } = await payload.find({
      collection: 'delivery-zones',
      where: { slug: { equals: 'tbilisi' } },
      limit: 1,
      overrideAccess: true,
    })
    await expect(
      payload.update({
        collection: 'delivery-zones',
        id: docs[0]!.id,
        data: { active: false },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ status: 400, message: ka.server.deliveryZones.tbilisiCannotDeactivate })
  })

  it('an inactive zone does not appear in the public DTO, and active ones are ordered by sortOrder', async () => {
    const active1 = await createZone({ feeGel: 200, sortOrder: 5000 })
    const active2 = await createZone({ feeGel: 200, sortOrder: 4000 })
    const inactive = await createZone({ feeGel: 200, sortOrder: 1, active: false })

    const zones = await getPublicDeliveryZones(payload)
    const slugs = zones.map((zone) => zone.slug)
    expect(slugs).not.toContain(inactive.slug)
    expect(slugs.indexOf(active2.slug!)).toBeLessThan(slugs.indexOf(active1.slug!))

    for (const zone of zones) {
      expect(Object.keys(zone).sort()).toEqual(['examples', 'feeGel', 'name', 'slug'])
    }
  })

  it('saving a zone sends a {"tags":["settings"]} revalidate request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await createZone({ feeGel: 200 })

    expect(fetchMock).toHaveBeenCalled()
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
    expect(JSON.parse(lastCall[1].body as string)).toEqual({ tags: ['settings'] })
  })
})
