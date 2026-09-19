// ADR 0018 (T5.17): the login gate, exercised through the *real* REST route
// (like auditEvents.int.spec.ts) — requireTotp reads `req.data.totp`,
// which only a real REST request populates (the Local API's
// `payload.login()` never sets `req.data`, so it can't exercise this at
// all — see tests/int/users.int.spec.ts's lockout test, which stays on the
// Local API and is unaffected by this file).
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import { REST_GET, REST_PATCH, REST_POST } from '@payloadcms/next/routes'
import config from '@/payload.config'

import { currentTotpCode, enrollTotp, resetTotpLastStep } from '../helpers/totp'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload

const EMAIL = 'totp-test@samkvetlo.local'
const PASSWORD = 'totp-test-password-16'

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payloadSegment] = token.split('.')
  const json = Buffer.from(payloadSegment!, 'base64url').toString('utf8')
  return JSON.parse(json) as Record<string, unknown>
}

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

async function totpFailureCount(userId: number | string): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'audit-events',
    where: { and: [{ type: { equals: 'login.totp-failed' } }, { user: { equals: userId } }] },
    overrideAccess: true,
  })
  return totalDocs
}

/**
 * requireTotp.ts deliberately does *not* await its login.totp-failed write
 * (see its comment — awaiting it inside the still-open login transaction
 * deadlocks on the users-row FK, reproduced against real Postgres). The
 * write lands a few ms after the 401 response, once loginOperation's own
 * catch block finishes killTransaction — so assertions on it poll briefly
 * instead of assuming it's already there.
 */
async function waitForTotpFailureCount(userId: number | string, expected: number): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = await totpFailureCount(userId)
    if (count >= expected) return count
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return totpFailureCount(userId)
}

describe('requireTotp / admin 2FA (T5.17, ADR 0018)', () => {
  let userId: number

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    await payload.delete({ collection: 'audit-events', where: { user: { equals: userId } }, overrideAccess: true })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
  })

  describe('(1) spike (c) reproduction — a user with no totpSecret can never log in', () => {
    beforeAll(async () => {
      await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
      const user = await payload.create({ collection: 'users', data: { email: EMAIL, password: PASSWORD }, overrideAccess: true })
      userId = user.id
    })

    it('correct password, no code -> 401, no token/cookie', async () => {
      const response = await restLogin({ email: EMAIL, password: PASSWORD })
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeFalsy()
      const body = (await response.json()) as { token?: string }
      expect(body.token).toBeUndefined()
    })

    it('correct password, a well-formed code -> still 401 (fail closed)', async () => {
      const response = await restLogin({ email: EMAIL, password: PASSWORD, totp: '123456' })
      expect(response.status).toBe(401)
    })

    it('/api/orders, /api/users, /api/suppliers, /api/costings are unreachable for this user', async () => {
      // No token was ever issued (previous tests), so there is nothing to
      // authenticate with — the closed access itself is the assertion.
      for (const path of ['/api/orders', '/api/users', '/api/suppliers', '/api/costings']) {
        const response = await restGet(path)
        expect(response.status).not.toBe(200)
      }
    })
  })

  describe('(2)-(4) enrolled user: wrong/replayed/throttled codes, then success', () => {
    let secret: string

    beforeAll(async () => {
      await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
      const user = await payload.create({ collection: 'users', data: { email: EMAIL, password: PASSWORD }, overrideAccess: true })
      userId = user.id
      secret = await enrollTotp(payload, userId)
    })

    it('enrolled, no code -> 401', async () => {
      const response = await restLogin({ email: EMAIL, password: PASSWORD })
      expect(response.status).toBe(401)
    })

    it('enrolled, wrong code -> 401 and writes exactly one login.totp-failed row (no IP)', async () => {
      const before = await totpFailureCount(userId)
      const response = await restLogin({ email: EMAIL, password: PASSWORD, totp: '000000' })
      expect(response.status).toBe(401)
      expect(await waitForTotpFailureCount(userId, before + 1)).toBe(before + 1)

      const { docs } = await payload.find({
        collection: 'audit-events',
        where: { and: [{ type: { equals: 'login.totp-failed' } }, { user: { equals: userId } }] },
        overrideAccess: true,
        sort: '-createdAt',
        limit: 1,
      })
      expect(JSON.stringify(docs[0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
    })

    it('enrolled, correct code -> 200, and /api/orders is now reachable', async () => {
      const response = await restLogin({ email: EMAIL, password: PASSWORD, totp: currentTotpCode(secret) })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { token: string }
      expect(body.token).toBeTruthy()

      const ordersResponse = await restGet('/api/orders', body.token)
      expect(ordersResponse.status).toBe(200)
    })

    it('(3) the same code cannot be used twice (replay)', async () => {
      // The previous test already logged in and advanced totpLastStep —
      // reset it so this test starts from a clean replay-guard state
      // regardless of what step that consumed.
      await resetTotpLastStep(payload, userId)
      const code = currentTotpCode(secret)
      const first = await restLogin({ email: EMAIL, password: PASSWORD, totp: code })
      expect(first.status).toBe(200)

      const second = await restLogin({ email: EMAIL, password: PASSWORD, totp: code })
      expect(second.status).toBe(401)
    })

    it('(4) after 5 wrong codes, even the 6th *correct* code is throttled — until 15 minutes pass', async () => {
      // A dedicated user with zero audit-event history, so the throttle
      // count (last 15 min, this user) can't pick up rows any other test
      // in this file wrote for EMAIL.
      const throttleEmail = 'totp-throttle-test@samkvetlo.local'
      await payload.delete({ collection: 'users', where: { email: { equals: throttleEmail } }, overrideAccess: true })
      const throttleUser = await payload.create({
        collection: 'users',
        data: { email: throttleEmail, password: PASSWORD },
        overrideAccess: true,
      })
      const throttleSecret = await enrollTotp(payload, throttleUser.id)

      vi.useFakeTimers({ toFake: ['Date'] })
      const start = new Date()
      vi.setSystemTime(start)
      try {
        for (let i = 0; i < 5; i += 1) {
          const response = await restLogin({ email: throttleEmail, password: PASSWORD, totp: '000000' })
          expect(response.status).toBe(401)
          await waitForTotpFailureCount(throttleUser.id, i + 1)
        }

        const stillThrottled = await restLogin({ email: throttleEmail, password: PASSWORD, totp: currentTotpCode(throttleSecret) })
        expect(stillThrottled.status).toBe(401)

        vi.setSystemTime(new Date(start.getTime() + 15 * 60 * 1000 + 1000))
        const afterWindow = await restLogin({ email: throttleEmail, password: PASSWORD, totp: currentTotpCode(throttleSecret) })
        expect(afterWindow.status).toBe(200)
      } finally {
        vi.useRealTimers()
        await payload.delete({ collection: 'audit-events', where: { user: { equals: throttleUser.id } }, overrideAccess: true })
        await payload.delete({ collection: 'users', id: throttleUser.id, overrideAccess: true })
      }
    })

    // Code review finding: the throttle counter used to be a live COUNT of
    // recent login.totp-failed rows, so concurrent requests could each read
    // the count before any of their own writes landed and all slip past
    // the limit. users.totpFailCount is now reserved atomically *before*
    // any transaction opens (reserveTotpAttempt.ts, `UPDATE ... RETURNING`)
    // — this asserts concurrent attempts never lose an increment against
    // each other (the count converges to the true number of attempts, not
    // fewer). The test below this one asserts the *decision* itself (how
    // many of a concurrent flood actually get to attempt verification) is
    // now also correctly serialized, which this one alone doesn't prove.
    it('concurrent wrong-code attempts never lose an increment (atomic counter)', async () => {
      const concurrentEmail = 'totp-concurrent-test@samkvetlo.local'
      await payload.delete({ collection: 'users', where: { email: { equals: concurrentEmail } }, overrideAccess: true })
      const concurrentUser = await payload.create({
        collection: 'users',
        data: { email: concurrentEmail, password: PASSWORD },
        overrideAccess: true,
      })
      await enrollTotp(payload, concurrentUser.id)

      try {
        const attempts = 4
        const responses = await Promise.all(
          Array.from({ length: attempts }, () => restLogin({ email: concurrentEmail, password: PASSWORD, totp: '000000' })),
        )
        for (const response of responses) {
          expect(response.status).toBe(401)
        }

        // reserveTotpAttempt's reservation is awaited inside beforeOperation,
        // before the transaction even opens — by the time each restLogin
        // call's promise resolves, its own increment has already landed. A
        // short poll is kept anyway as a robustness margin, not because
        // it's expected to actually loop.
        let finalCount: number | null | undefined
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const reloaded = await payload.findByID({ collection: 'users', id: concurrentUser.id, overrideAccess: true })
          finalCount = reloaded.totpFailCount
          if ((finalCount ?? 0) >= attempts) break
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(finalCount).toBe(attempts)
      } finally {
        await payload.delete({ collection: 'audit-events', where: { user: { equals: concurrentUser.id } }, overrideAccess: true })
        await payload.delete({ collection: 'users', id: concurrentUser.id, overrideAccess: true })
      }
    })

    // Code review finding, the part the previous test alone doesn't prove:
    // the *decision* each concurrent request makes (attempt it for real vs.
    // reject as already-throttled) must itself be serialized, or a flood of
    // simultaneous guesses could all read a pre-increment count and all get
    // a real attempt against the algorithm regardless of the 5-attempt cap.
    // reserveTotpAttempt.ts's `UPDATE ... RETURNING` closes exactly this —
    // awaited, before any transaction/lock exists, so 10 concurrent
    // requests for the same user serialize into reservations 1..10, and
    // only the first 5 are ever told "allowed". Observable from outside
    // reserveTotpAttempt/requireTotp: only an *allowed* attempt that then
    // fails verification writes a `login.totp-failed` audit event (an
    // already-throttled rejection deliberately doesn't, to avoid writing
    // one per flood request) — so exactly 5 audit rows, out of 10
    // concurrent wrong-code requests, is direct evidence the cap held under
    // real concurrency, not just eventually-consistent counting.
    it('a flood of concurrent wrong-code attempts is capped at exactly 5 real attempts (atomic reservation)', async () => {
      const floodEmail = 'totp-flood-test@samkvetlo.local'
      await payload.delete({ collection: 'users', where: { email: { equals: floodEmail } }, overrideAccess: true })
      const floodUser = await payload.create({
        collection: 'users',
        data: { email: floodEmail, password: PASSWORD },
        overrideAccess: true,
      })
      await enrollTotp(payload, floodUser.id)

      try {
        const attempts = 10
        const responses = await Promise.all(
          Array.from({ length: attempts }, () => restLogin({ email: floodEmail, password: PASSWORD, totp: '000000' })),
        )
        for (const response of responses) {
          expect(response.status).toBe(401)
        }

        // Audit-event writes are still fire-and-forget (see requireTotp.ts) —
        // poll for them to land, same as the other tests in this file.
        expect(await waitForTotpFailureCount(floodUser.id, 5)).toBe(5)

        const reloaded = await payload.findByID({ collection: 'users', id: floodUser.id, overrideAccess: true })
        expect(reloaded.totpFailCount).toBe(attempts)
      } finally {
        await payload.delete({ collection: 'audit-events', where: { user: { equals: floodUser.id } }, overrideAccess: true })
        await payload.delete({ collection: 'users', id: floodUser.id, overrideAccess: true })
      }
    })
  })

  describe('(7) totpSecret/totpLastStep never leave the API; an admin cannot set them by PATCH', () => {
    let secret: string
    let token: string

    beforeAll(async () => {
      await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
      const user = await payload.create({ collection: 'users', data: { email: EMAIL, password: PASSWORD }, overrideAccess: true })
      userId = user.id
      secret = await enrollTotp(payload, userId)

      const loginResponse = await restLogin({ email: EMAIL, password: PASSWORD, totp: currentTotpCode(secret) })
      expect(loginResponse.status).toBe(200)
      const body = (await loginResponse.json()) as { token: string; user: Record<string, unknown> }
      token = body.token
      expect(body.user.totpSecret).toBeUndefined()
      expect(body.user.totpLastStep).toBeUndefined()
    })

    it('is absent from the JWT payload', () => {
      const claims = decodeJwtPayload(token)
      expect(claims.totpSecret).toBeUndefined()
      expect(claims.totpLastStep).toBeUndefined()
    })

    it('is absent from GET /api/users/:id and /api/users/me', async () => {
      const byId = await restGet(`/api/users/${userId}`, token)
      expect(byId.status).toBe(200)
      const byIdBody = (await byId.json()) as Record<string, unknown>
      expect(byIdBody.totpSecret).toBeUndefined()
      expect(byIdBody.totpLastStep).toBeUndefined()

      const me = await restGet('/api/users/me', token)
      expect(me.status).toBe(200)
      const meBody = (await me.json()) as { user?: Record<string, unknown> }
      expect(meBody.user?.totpSecret).toBeUndefined()
      expect(meBody.user?.totpLastStep).toBeUndefined()
    })

    it('an admin PATCH with { totpSecret } does not change the stored secret', async () => {
      const handler = REST_PATCH(config)
      const request = new Request(`http://localhost:3001/api/users/${userId}`, {
        method: 'PATCH',
        headers: new Headers({ 'content-type': 'application/json', Authorization: `JWT ${token}` }),
        body: JSON.stringify({ totpSecret: 'attacker-supplied-secret' }),
      })
      const response = await handler(request, { params: Promise.resolve({ slug: ['users', String(userId)] }) })
      expect(response.status).toBe(200)

      const reloaded = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true, depth: 0 })
      expect(reloaded.totpSecret).toBe(secret)
    })
  })

  describe('(6) reset-password without a code is fully blocked', () => {
    let secret: string

    beforeAll(async () => {
      await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
      const user = await payload.create({ collection: 'users', data: { email: EMAIL, password: PASSWORD }, overrideAccess: true })
      userId = user.id
      secret = await enrollTotp(payload, userId)
    })

    it('a valid reset token, no code -> no token/cookie, and the password itself is not changed (same transaction rolls back)', async () => {
      const resetToken = 'totp-test-reset-token'
      await payload.update({
        collection: 'users',
        id: userId,
        data: { resetPasswordToken: resetToken, resetPasswordExpiration: new Date(Date.now() + 60_000).toISOString() },
        overrideAccess: true,
      })

      const handler = REST_POST(config)
      const request = new Request('http://localhost:3001/api/users/reset-password', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ token: resetToken, password: 'brand-new-password-16' }),
      })
      const response = await handler(request, { params: Promise.resolve({ slug: ['users', 'reset-password'] }) })
      expect(response.status).toBe(401)
      expect(response.headers.get('set-cookie')).toBeFalsy()

      // resetPassword runs in one transaction that also writes the new
      // hash/salt *before* beforeLogin runs (see the ADR's fact table) —
      // requireTotp rejecting it (no `totp` in this request) rolls that
      // back too. Provable without touching requireTotp again: log in
      // with a *valid* code and the OLD password — password verification
      // happens before beforeLogin, so this only succeeds if the DB
      // password is still the original one.
      const stillOldPassword = await restLogin({ email: EMAIL, password: PASSWORD, totp: currentTotpCode(secret) })
      expect(stillOldPassword.status).toBe(200)
    })
  })
})
