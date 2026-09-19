// ADR 0018 addendum A (T5.17a): server-side session revocation, the 12 h
// absolute cap, and the CI push/migrate drift guard. Exercised through the
// *real* REST routes (same pattern as tests/int/totp.int.spec.ts) — a real
// cookie/token, not the Local API, since that's what an actual admin
// session is.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import { REST_GET, REST_POST } from '@payloadcms/next/routes'
import { sql } from '@payloadcms/db-postgres'
import config from '@/payload.config'

import { currentTotpCode, enrollTotp } from '../helpers/totp'
import { revokeUserSessions } from '@/server/security/sessions'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const PASSWORD = 'sessions-test-password-16'

async function restLogin(body: Record<string, unknown>): Promise<Response> {
  const handler = REST_POST(config)
  const request = new Request('http://localhost:3001/api/users/login', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve({ slug: ['users', 'login'] }) })
}

async function restGet(path: string, token?: string): Promise<Response> {
  const handler = REST_GET(config)
  const headers = new Headers()
  if (token) headers.set('Authorization', `JWT ${token}`)
  const request = new Request(`http://localhost:3001${path}`, { method: 'GET', headers })
  const slug = path.replace('/api/', '').split('/').filter(Boolean)
  return handler(request, { params: Promise.resolve({ slug }) })
}

async function restPost(path: string, token?: string, body?: Record<string, unknown>): Promise<Response> {
  const handler = REST_POST(config)
  const headers = new Headers()
  if (token) headers.set('Authorization', `JWT ${token}`)
  if (body) headers.set('content-type', 'application/json')
  const request = new Request(`http://localhost:3001${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const slug = path.replace('/api/', '').split('/').filter(Boolean)
  return handler(request, { params: Promise.resolve({ slug }) })
}

async function loginAndGetToken(email: string, secret: string): Promise<string> {
  const response = await restLogin({ email, password: PASSWORD, totp: currentTotpCode(secret) })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { token: string }
  return body.token
}

async function sessionRowCount(userId: number | string): Promise<number> {
  const drizzle = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<{ rows: unknown[] }> } }).drizzle
  const result = await drizzle.execute(sql`SELECT id FROM "users_sessions" WHERE "_parent_id" = ${userId}`)
  return result.rows.length
}

async function backdateOnlySession(userId: number | string, createdAt: Date): Promise<void> {
  const drizzle = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> } }).drizzle
  await drizzle.execute(
    sql`UPDATE "users_sessions" SET "created_at" = ${createdAt.toISOString()} WHERE "_parent_id" = ${userId}`,
  )
}

async function createUser(email: string): Promise<{ id: number; secret: string }> {
  await payload.delete({ collection: 'users', where: { email: { equals: email } }, overrideAccess: true })
  const user = await payload.create({ collection: 'users', data: { email, password: PASSWORD }, overrideAccess: true })
  const secret = await enrollTotp(payload, user.id)
  return { id: user.id, secret }
}

describe('session revocation / absolute cap (T5.17a, ADR 0018 addendum A)', () => {
  const EMAIL_A = 'sessions-test-a@samkvetlo.local'
  const EMAIL_B = 'sessions-test-b@samkvetlo.local'

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const email of [EMAIL_A, EMAIL_B]) {
      await payload.delete({ collection: 'users', where: { email: { equals: email } }, overrideAccess: true }).catch(() => undefined)
    }
  })

  it('(1) useSessions is true in the sanitized config', async () => {
    const resolved = await config
    const usersCollection = resolved.collections?.find((c) => c.slug === 'users')
    expect(usersCollection?.auth?.useSessions).toBe(true)
  })

  it('(2) login writes one users_sessions row, and /api/users/me works with that token', async () => {
    const { id: userId, secret } = await createUser(EMAIL_A)
    expect(await sessionRowCount(userId)).toBe(0)

    const token = await loginAndGetToken(EMAIL_A, secret)
    expect(await sessionRowCount(userId)).toBe(1)

    const me = await restGet('/api/users/me', token)
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { user: { email: string } | null }
    expect(meBody.user?.email).toBe(EMAIL_A)
  })

  it('(3) revoking sessions: the old token stops working; another user is unaffected', async () => {
    const userA = await createUser(EMAIL_A)
    const userB = await createUser(EMAIL_B)
    const tokenA = await loginAndGetToken(EMAIL_A, userA.secret)
    const tokenB = await loginAndGetToken(EMAIL_B, userB.secret)

    const revokedCount = await revokeUserSessions({ payload, userId: userA.id })
    expect(revokedCount).toBe(1)
    expect(await sessionRowCount(userA.id)).toBe(0)

    const meA = await restGet('/api/users/me', tokenA)
    expect(meA.status).toBe(200) // me never 401s — it reports { user: null }
    const meABody = (await meA.json()) as { user: unknown }
    expect(meABody.user).toBeNull()

    const ordersA = await restGet('/api/orders', tokenA)
    expect(ordersA.status).not.toBe(200)

    const refreshA = await restPost('/api/users/refresh-token', tokenA)
    expect(refreshA.status).not.toBe(200)

    // userB's session is untouched.
    expect(await sessionRowCount(userB.id)).toBe(1)
    const meB = await restGet('/api/users/me', tokenB)
    const meBBody = (await meB.json()) as { user: { email: string } | null }
    expect(meBBody.user?.email).toBe(EMAIL_B)
  })

  it('(4) changing another user\'s password revokes all of *their* sessions; the actor keeps theirs', async () => {
    const userA = await createUser(EMAIL_A) // the actor (admin)
    const userB = await createUser(EMAIL_B) // whose password gets changed
    const tokenA = await loginAndGetToken(EMAIL_A, userA.secret)
    await loginAndGetToken(EMAIL_B, userB.secret)
    expect(await sessionRowCount(userB.id)).toBe(1)

    await payload.update({
      collection: 'users',
      id: userB.id,
      data: { password: 'a-brand-new-password-16' },
      overrideAccess: true,
    })

    expect(await sessionRowCount(userB.id)).toBe(0)
    expect(await sessionRowCount(userA.id)).toBe(1)
    const meA = await restGet('/api/users/me', tokenA)
    const meABody = (await meA.json()) as { user: { email: string } | null }
    expect(meABody.user?.email).toBe(EMAIL_A)
  })

  it('(4b) a non-password update does not touch sessions', async () => {
    const userA = await createUser(EMAIL_A)
    await loginAndGetToken(EMAIL_A, userA.secret)
    expect(await sessionRowCount(userA.id)).toBe(1)

    await payload.update({ collection: 'users', id: userA.id, data: { totpEnabledAt: new Date().toISOString() }, overrideAccess: true })

    expect(await sessionRowCount(userA.id)).toBe(1)
  })

  it('(5) absolute session cap: a session older than 12h fails refresh; younger than 12h succeeds', async () => {
    const userA = await createUser(EMAIL_A)
    const tokenOld = await loginAndGetToken(EMAIL_A, userA.secret)
    await backdateOnlySession(userA.id, new Date(Date.now() - 12 * 60 * 60 * 1000 - 60 * 1000))

    const refreshOld = await restPost('/api/users/refresh-token', tokenOld)
    expect(refreshOld.status).not.toBe(200)
    // The row itself wasn't touched by the rejected refresh (no expires_at bump).
    expect(await sessionRowCount(userA.id)).toBe(1)

    // A second, fresh login (session younger than 12h) still refreshes fine.
    const userA2 = await createUser(EMAIL_A)
    const tokenFresh = await loginAndGetToken(EMAIL_A, userA2.secret)
    await backdateOnlySession(userA2.id, new Date(Date.now() - 11 * 60 * 60 * 1000))
    const refreshFresh = await restPost('/api/users/refresh-token', tokenFresh)
    expect(refreshFresh.status).toBe(200)
  })

  it('(7) deleting a user cascades its users_sessions rows', async () => {
    const userA = await createUser(EMAIL_A)
    await loginAndGetToken(EMAIL_A, userA.secret)
    expect(await sessionRowCount(userA.id)).toBe(1)

    await payload.delete({ collection: 'users', id: userA.id, overrideAccess: true })
    expect(await sessionRowCount(userA.id)).toBe(0)
  })
})
