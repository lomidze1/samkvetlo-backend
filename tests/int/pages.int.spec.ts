// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const pageIds: (number | string)[] = []

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

describe('pages collection (T1.8)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of pageIds) await payload.delete({ collection: 'pages', id }).catch(() => undefined)
  })

  it('is created in the admin (Local API) with one of the five fixed slugs', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: { slug: 'how-we-work', title: 'როგორ ვმუშაობთ', content: EMPTY_RICH_TEXT },
    })
    pageIds.push(page.id)
    expect(page.slug).toBe('how-we-work')
  })

  it('an anonymous read works (public content, no hidden fields)', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: { slug: 'about', title: 'ჩვენს შესახებ', content: EMPTY_RICH_TEXT },
    })
    pageIds.push(page.id)

    const found = await payload.findByID({ collection: 'pages', id: page.id, overrideAccess: false, user: null })
    expect(found.title).toBe('ჩვენს შესახებ')
  })

  it('rejects a slug outside the fixed set', async () => {
    // Deliberately invalid input (the point of the test) — `select`'s
    // generated type only allows the 5 real slugs, so this needs an escape
    // hatch narrower than `any` to construct the bad payload.
    const invalidData = { slug: 'random-page', title: 'x', content: EMPTY_RICH_TEXT }
    await expect(payload.create({ collection: 'pages', data: invalidData as never })).rejects.toBeTruthy()
  })
})
