// See media.int.spec.ts: file-type needs the real Node Uint8Array realm.
// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let mediaId: number
const portfolioIds: (number | string)[] = []

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')

describe('portfolio collection (T1.8)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const data = await fs.readFile(path.join(FIXTURES_DIR, 'product-3000x2000.jpg'))
    const media = await payload.create({
      collection: 'media',
      data: { alt: 'პორტფოლიოს ტესტის ფოტო' },
      file: { data, mimetype: 'image/jpeg', name: 'portfolio-test.jpg', size: data.length },
    })
    mediaId = media.id
  })

  afterAll(async () => {
    for (const id of portfolioIds) await payload.delete({ collection: 'portfolio', id }).catch(() => undefined)
    await payload.delete({ collection: 'media', id: mediaId }).catch(() => undefined)
  })

  it('is created in the admin as a draft without consent', async () => {
    const item = await payload.create({
      collection: 'portfolio',
      data: { church: 'წმინდა ნინოს ეკლესია', photos: [mediaId], consent: false, _status: 'draft' },
    })
    portfolioIds.push(item.id)
    expect(item._status).toBe('draft')
  })

  it('an anonymous read works', async () => {
    const item = await payload.create({
      collection: 'portfolio',
      data: { church: 'სამების ეკლესია', photos: [mediaId], consent: true, _status: 'published' },
    })
    portfolioIds.push(item.id)

    const found = await payload.findByID({ collection: 'portfolio', id: item.id, overrideAccess: false, user: null })
    expect(found.church).toBe('სამების ეკლესია')
  })

  it('cannot be published without consent', async () => {
    await expect(
      payload.create({
        collection: 'portfolio',
        data: { church: 'თანხმობის-გარეშე', photos: [mediaId], consent: false, _status: 'published' },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('publishes once consent is true', async () => {
    const item = await payload.create({
      collection: 'portfolio',
      data: { church: 'თანხმობით', photos: [mediaId], consent: true, _status: 'published' },
    })
    portfolioIds.push(item.id)
    expect(item._status).toBe('published')
  })

  // Code review fix: the slug used to be recomputed from `church` on every
  // save (unique + unconditional), so a second entry for the same church
  // failed outright and a rename changed the URL.
  it('two entries for the same church get slug and slug-2 (collision suffix)', async () => {
    const first = await payload.create({
      collection: 'portfolio',
      data: { church: 'ეკლესია-დუბლიკატი', photos: [mediaId], consent: true },
    })
    portfolioIds.push(first.id)
    const second = await payload.create({
      collection: 'portfolio',
      data: { church: 'ეკლესია-დუბლიკატი', photos: [mediaId], consent: true },
    })
    portfolioIds.push(second.id)

    expect(first.slug).toBe('eklesia-dublikati')
    expect(second.slug).toBe('eklesia-dublikati-2')
  })

  it('renaming church afterwards does not change the existing slug', async () => {
    const item = await payload.create({
      collection: 'portfolio',
      data: { church: 'თავდაპირველი-სახელი', photos: [mediaId], consent: true },
    })
    portfolioIds.push(item.id)
    const originalSlug = item.slug

    const renamed = await payload.update({
      collection: 'portfolio',
      id: item.id,
      data: { church: 'შეცვლილი-სახელი' },
    })

    expect(renamed.church).toBe('შეცვლილი-სახელი')
    expect(renamed.slug).toBe(originalSlug)
  })
})
