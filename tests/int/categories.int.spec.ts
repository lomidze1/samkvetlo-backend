import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const createdIds: (number | string)[] = []

describe('categories collection (T1.2)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of createdIds) {
      await payload.delete({ collection: 'categories', id }).catch(() => undefined)
    }
  })

  it('auto-generates a unique slug from the name via transliteration', async () => {
    const doc = await payload.create({
      collection: 'categories',
      data: { name: 'საეკლესიო ზარი' },
    })
    createdIds.push(doc.id)
    expect(doc.slug).toBe('saeklesio-zari')
  })

  it('builds a tree via the parent relationship', async () => {
    const parent = await payload.create({ collection: 'categories', data: { name: 'ზარები' } })
    createdIds.push(parent.id)
    const child = await payload.create({
      collection: 'categories',
      data: { name: 'საეკლესიო ზარები', parent: parent.id },
    })
    createdIds.push(child.id)

    const fetched = await payload.findByID({ collection: 'categories', id: child.id, depth: 0 })
    expect(fetched.parent).toBe(parent.id)
  })

  it('rejects a name whose slug collides with a protected route (e.g. "ს" -> "s")', async () => {
    await expect(
      payload.create({ collection: 'categories', data: { name: 'ს' } }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
