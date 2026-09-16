// ADR 0014 §4 fallback (TOTP spike failed, T5.9) + ADR 0016 (T5.14): every
// successful login is audited (src/collections/hooks/loginAudit.ts) — not
// just break-glass ones — because a stolen password used from inside
// Georgia produces zero signal under geo + lockout alone. The header check
// lives in Users.hooks.afterLogin, which only ever sees
// `x-vercel-ip-country` on a real REST login request — so this exercises
// the actual REST route (like secrecy.int.spec.ts's
// `callBuiltInRestAnonymously`), not the local API.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import { REST_GET, REST_POST } from '@payloadcms/next/routes'
import config from '@/payload.config'

import { memoryEmailSender } from '@/server/notify/memoryAdapter'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload

const EMAIL = 'break-glass-test@samkvetlo.local'
const PASSWORD = 'break-glass-password-16'
const OWNER_EMAIL = 'owner-break-glass@samkvetlo.local'

async function login(country: string | null): Promise<Response> {
  const handler = REST_POST(config)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (country) headers.set('x-vercel-ip-country', country)
  const request = new Request('http://localhost:3001/api/users/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  return handler(request, { params: Promise.resolve({ slug: ['users', 'login'] }) })
}

async function auditEventsForUser(userId: number | string): Promise<number> {
  const { totalDocs } = await payload.find({
    collection: 'audit-events',
    where: { user: { equals: userId } },
    overrideAccess: true,
    limit: 0,
  })
  return totalDocs
}

describe('audit-events (ADR 0014 §4 fallback, ADR 0016, T5.14)', () => {
  let userId: number

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    process.env.EMAIL_ADAPTER = 'memory'

    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: OWNER_EMAIL }] },
      overrideAccess: true,
    })

    const user = await payload.create({
      collection: 'users',
      data: { email: EMAIL, password: PASSWORD },
      overrideAccess: true,
    })
    userId = user.id
  })

  afterEach(async () => {
    memoryEmailSender.reset()
    // Each login test asserts an absolute count for `userId`, so it must
    // start from zero regardless of what an earlier test in this file left.
    await payload.delete({ collection: 'audit-events', where: { user: { equals: userId } }, overrideAccess: true })
  })

  afterAll(async () => {
    delete process.env.EMAIL_ADAPTER
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [] },
      overrideAccess: true,
    })
    await payload.delete({ collection: 'audit-events', where: { user: { equals: userId } }, overrideAccess: true })
    await payload.delete({ collection: 'users', id: userId, overrideAccess: true })
  })

  it('a login with a non-GE x-vercel-ip-country writes one login.break-glass record (no IP) and one owner email', async () => {
    const response = await login('DE')
    expect(response.status).toBe(200)

    expect(await auditEventsForUser(userId)).toBe(1)

    const { docs } = await payload.find({
      collection: 'audit-events',
      where: { user: { equals: userId } },
      overrideAccess: true,
      limit: 1,
    })
    expect(docs[0]).toMatchObject({ type: 'login.break-glass', country: 'DE' })
    expect(JSON.stringify(docs[0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/)

    expect(memoryEmailSender.sent).toHaveLength(1)
    expect(memoryEmailSender.sent[0]).toMatchObject({ to: [OWNER_EMAIL] })
    expect(memoryEmailSender.sent[0].text).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })

  it('a login with x-vercel-ip-country: GE writes one login.success record and sends no email', async () => {
    const response = await login('GE')
    expect(response.status).toBe(200)

    expect(await auditEventsForUser(userId)).toBe(1)

    const { docs } = await payload.find({
      collection: 'audit-events',
      where: { user: { equals: userId } },
      overrideAccess: true,
      limit: 1,
    })
    expect(docs[0]).toMatchObject({ type: 'login.success', country: 'GE' })

    expect(memoryEmailSender.sent).toHaveLength(0)
  })

  it('a login with no x-vercel-ip-country header (local/Docker/test-style request) writes exactly one login.success row and sends no email', async () => {
    const response = await login(null)
    expect(response.status).toBe(200)

    expect(await auditEventsForUser(userId)).toBe(1)

    const { docs } = await payload.find({
      collection: 'audit-events',
      where: { user: { equals: userId } },
      overrideAccess: true,
      limit: 1,
    })
    expect(docs[0]?.type).toBe('login.success')
    expect(docs[0]?.country).toBeFalsy()

    expect(memoryEmailSender.sent).toHaveLength(0)
  })

  it('a failing audit-events write does not block the login', async () => {
    const originalCreate = payload.create.bind(payload)
    const createSpy = vi.spyOn(payload, 'create').mockImplementation(async (args) => {
      if (args.collection === 'audit-events') throw new Error('boom')
      return originalCreate(args)
    })
    const loggerSpy = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)

    try {
      const response = await login('GE')
      expect(response.status).toBe(200)
      expect(loggerSpy).toHaveBeenCalled()
    } finally {
      createSpy.mockRestore()
      loggerSpy.mockRestore()
    }
  })

  it('an anonymous GET /api/audit-events is rejected with 403', async () => {
    const handler = REST_GET(config)
    const request = new Request('http://localhost:3001/api/audit-events', { method: 'GET' })
    const response = await handler(request, { params: Promise.resolve({ slug: ['audit-events'] }) })
    expect(response.status).toBe(403)
  })

  it('an admin cannot update or delete an audit-events record, even with overrideAccess: false', async () => {
    const admin = await payload.create({
      collection: 'users',
      data: { email: `audit-events-admin-${Date.now()}@samkvetlo.local`, password: 'audit-events-admin-pw-16' },
      overrideAccess: true,
    })
    try {
      const { docs } = await payload.find({
        collection: 'audit-events',
        where: { user: { equals: userId } },
        overrideAccess: true,
        limit: 1,
      })
      // Re-create one if the earlier tests' cleanup already ran (test order
      // isn't guaranteed across files, but is within this describe block).
      const event =
        docs[0] ??
        (await payload.create({
          collection: 'audit-events',
          data: { type: 'login.break-glass', user: userId, country: 'DE', at: new Date().toISOString() },
          overrideAccess: true,
        }))

      await expect(
        payload.update({
          collection: 'audit-events',
          id: event.id,
          data: { country: 'US' },
          overrideAccess: false,
          user: admin,
        }),
      ).rejects.toThrow()

      await expect(
        payload.delete({
          collection: 'audit-events',
          id: event.id,
          overrideAccess: false,
          user: admin,
        }),
      ).rejects.toThrow()
    } finally {
      await payload.delete({ collection: 'users', id: admin.id, overrideAccess: true })
    }
  })
})
