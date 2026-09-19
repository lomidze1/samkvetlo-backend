// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import { REST_DELETE, REST_GET, REST_PATCH, REST_POST } from '@payloadcms/next/routes'
import config from '@/payload.config'

import { getPublicShortLinks } from '@/server/public/shortLinks'
import { shortLinksEndpoint } from '@/endpoints/public/shortLinks'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload
const linkIds: (number | string)[] = []

async function createLink(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = await payload.create({
    collection: 'short-links',
    data: { slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, target: '/zarebi', ...overrides },
    overrideAccess: true,
  })
  linkIds.push(doc.id)
  return doc
}

function restRequest(method: string, path: string, body?: unknown) {
  const handler = { GET: REST_GET, POST: REST_POST, PATCH: REST_PATCH, DELETE: REST_DELETE }[method]!(config)
  const request = new Request(`http://localhost:3001${path}`, {
    method,
    headers: body ? new Headers({ 'content-type': 'application/json' }) : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const slug = path.replace('/api/', '').split('/').filter(Boolean)
  return handler(request, { params: Promise.resolve({ slug }) })
}

describe('short-links collection (T5.16, ADR 0017)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    for (const id of linkIds) await payload.delete({ collection: 'short-links', id, overrideAccess: true }).catch(() => undefined)
  })

  it('slug "FB " is trimmed and lowercased to "fb"', async () => {
    const doc = await createLink({ slug: 'FB ' })
    expect(doc.slug).toBe('fb')
  })

  it.each([['Fb-'], ['-x'], ['a_b'], ['a'.repeat(33)], ['ზარი']])('slug %s is rejected', async (slug) => {
    await expect(createLink({ slug })).rejects.toMatchObject({ status: 400 })
  })

  it('two links with the same slug violate the unique constraint', async () => {
    const slug = `dup-${Date.now()}`
    await createLink({ slug })
    await expect(createLink({ slug })).rejects.toBeTruthy()
  })

  it('the slug cannot be changed after creation (field-level access.update: () => false)', async () => {
    const doc = await createLink()
    const admin = await payload.create({
      collection: 'users',
      data: { email: `short-links-admin-${Date.now()}@samkvetlo.local`, password: 'short-links-admin-pw-16' },
      overrideAccess: true,
    })
    // overrideAccess: true (used everywhere else in this file) bypasses
    // *field*-level access too — this needs overrideAccess: false with a
    // real user, like an actual authenticated PATCH would run, to actually
    // exercise the field's own access.update: () => false.
    const updated = await payload.update({
      collection: 'short-links',
      id: doc.id,
      data: { slug: `changed-${Date.now()}` },
      overrideAccess: false,
      user: admin,
    })
    expect(updated.slug).toBe(doc.slug)
  })

  it('an absolute https://samkvetlo.ge/... target is rewritten to a path', async () => {
    const doc = await createLink({ target: 'https://samkvetlo.ge/zarebi' })
    expect(doc.target).toBe('/zarebi')
  })

  it('an external target with utmSource is rejected (utm is internal-target only)', async () => {
    await expect(
      createLink({ target: 'https://www.facebook.com/samkvetlo', utmSource: 'facebook' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('utmMedium without utmSource is rejected', async () => {
    await expect(createLink({ utmMedium: 'social' })).rejects.toMatchObject({ status: 400 })
  })

  it('an anonymous GET /api/short-links returns only active links, without note', async () => {
    const active = await createLink({ note: 'შიდა შენიშვნა' })
    const inactive = await createLink({ active: false })

    const response = await restRequest('GET', '/api/short-links')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { docs: Record<string, unknown>[] }
    const slugs = body.docs.map((doc) => doc.slug)
    expect(slugs).toContain(active.slug)
    expect(slugs).not.toContain(inactive.slug)
    expect(JSON.stringify(body)).not.toContain('შიდა შენიშვნა')
  })

  it('anonymous POST/PATCH/DELETE on /api/short-links are rejected with 403', async () => {
    const postResponse = await restRequest('POST', '/api/short-links', { slug: `anon-${Date.now()}`, target: '/zarebi' })
    expect(postResponse.status).toBe(403)

    const doc = await createLink()
    const patchResponse = await restRequest('PATCH', `/api/short-links/${doc.id}`, { active: false })
    expect(patchResponse.status).toBe(403)

    const deleteResponse = await restRequest('DELETE', `/api/short-links/${doc.id}`)
    expect(deleteResponse.status).toBe(403)
  })

  it('GET /api/public/short-links without a bearer token is 401', async () => {
    const response = await shortLinksEndpoint.handler({
      payload,
      headers: new Headers(),
      routeParams: {},
    } as unknown as Parameters<typeof shortLinksEndpoint.handler>[0])
    expect(response.status).toBe(401)
  })

  it('a category with slug "go" is rejected', async () => {
    // Categories.beforeValidate always derives slug from name (slugify),
    // overwriting any slug passed in directly — 'გო' -> 'go' is the
    // shortest real transliteration that lands on the protected slug.
    await expect(
      payload.create({ collection: 'categories', data: { name: 'გო' }, overrideAccess: true }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('the public DTO has exactly {slug, href} keys, and href carries the UTM params', async () => {
    const doc = await createLink({ slug: `dto-${Date.now()}`, target: '/zarebi', utmSource: 'facebook', utmMedium: 'social' })
    const links = await getPublicShortLinks(payload)
    const found = links.find((link) => link.slug === doc.slug)
    expect(found).toBeTruthy()
    expect(Object.keys(found!).sort()).toEqual(['href', 'slug'])
    expect(found!.href).toBe(`/zarebi?utm_source=facebook&utm_medium=social&utm_campaign=${doc.slug}`)
  })

  it('saving a link sends a {"tags":["links"]} revalidate request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await createLink()

    expect(fetchMock).toHaveBeenCalled()
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
    expect(JSON.parse(lastCall[1].body as string)).toEqual({ tags: ['links'] })
  })
})
