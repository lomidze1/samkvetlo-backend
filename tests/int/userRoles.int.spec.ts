// ADR 0018 addendum C: Super Admin / Admin roles, first-login QR enrollment
// and the Super Admin "reset 2FA" endpoint. Login goes through the real
// REST route (requireTotp reads req.data, see totp.int.spec.ts).
// @vitest-environment node
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { REST_POST } from '@payloadcms/next/routes'
import config from '@/payload.config'

import type { User } from '@/payload-types'
import { resetTotpEndpoint } from '@/endpoints/resetTotp'
import { currentTotpCode, enrollTotp } from '../helpers/totp'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload

const PASSWORD = 'roles-test-password-16'
const SUPER_EMAIL = 'roles-super@samkvetlo.invalid'
const ADMIN_EMAIL = 'roles-admin@samkvetlo.invalid'
const NEW_EMAIL = 'roles-new@samkvetlo.invalid'
const EMAILS = [SUPER_EMAIL, ADMIN_EMAIL, NEW_EMAIL]

async function restLogin(body: Record<string, unknown>): Promise<Response> {
  const handler = REST_POST(config)
  const request = new Request('http://localhost:3001/api/users/login', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve({ slug: ['users', 'login'] }) })
}

async function createUser(email: string, role?: 'admin' | 'super-admin'): Promise<User> {
  return payload.create({
    collection: 'users',
    data: { email, password: PASSWORD, ...(role ? { role } : {}) },
    overrideAccess: true,
  })
}

async function readUser(id: number | string): Promise<User> {
  return payload.findByID({ collection: 'users', id, overrideAccess: true, showHiddenFields: true })
}

async function callReset(by: User, targetId: number | string): Promise<Response> {
  const req = { payload, user: by, routeParams: { id: String(targetId) } } as unknown as PayloadRequest
  return resetTotpEndpoint.handler(req)
}

describe('user roles and first-login 2FA (ADR 0018 addendum C)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    await payload.delete({ collection: 'users', where: { email: { in: EMAILS } }, overrideAccess: true })
  })

  describe('access', () => {
    it('an Admin cannot create, list others, delete or change roles; can change own password', async () => {
      const superAdmin = await createUser(SUPER_EMAIL, 'super-admin')
      const admin = await createUser(ADMIN_EMAIL)
      expect(admin.role).toBe('admin')

      await expect(
        payload.create({ collection: 'users', data: { email: NEW_EMAIL, password: PASSWORD }, user: admin, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })

      const { docs } = await payload.find({ collection: 'users', user: admin, overrideAccess: false, limit: 100 })
      expect(docs.map((doc) => doc.id)).toEqual([admin.id])

      await expect(
        payload.delete({ collection: 'users', id: superAdmin.id, user: admin, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })

      const promoted = await payload.update({
        collection: 'users',
        id: admin.id,
        data: { role: 'super-admin' },
        user: admin,
        overrideAccess: false,
      })
      expect(promoted.role).toBe('admin')

      await expect(
        payload.update({
          collection: 'users',
          id: admin.id,
          data: { password: 'a-brand-new-password-16' },
          user: admin,
          overrideAccess: false,
        }),
      ).resolves.toMatchObject({ id: admin.id })
    })

    it('a Super Admin can create and delete others, but not delete themselves or change a role', async () => {
      const superAdmin = await createUser(SUPER_EMAIL, 'super-admin')

      const created = await payload.create({
        collection: 'users',
        data: { email: NEW_EMAIL, password: PASSWORD, role: 'super-admin' },
        user: superAdmin,
        overrideAccess: false,
      })
      expect(created.role).toBe('admin')

      const { totalDocs } = await payload.find({
        collection: 'users',
        where: { email: { in: EMAILS } },
        user: superAdmin,
        overrideAccess: false,
      })
      expect(totalDocs).toBe(2)

      await expect(
        payload.delete({ collection: 'users', id: superAdmin.id, user: superAdmin, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })

      // Roles are never edited in the admin, not even by a Super Admin.
      const demoted = await payload.update({
        collection: 'users',
        id: superAdmin.id,
        data: { role: 'admin' },
        user: superAdmin,
        overrideAccess: false,
      })
      expect(demoted.role).toBe('super-admin')

      await payload.delete({ collection: 'users', id: created.id, user: superAdmin, overrideAccess: false })
    })

    it('a Super Admin bulk delete never includes their own account', async () => {
      const superAdmin = await createUser(SUPER_EMAIL, 'super-admin')
      const other = await createUser(NEW_EMAIL)

      await payload.delete({
        collection: 'users',
        where: { email: { in: [SUPER_EMAIL, NEW_EMAIL] } },
        user: superAdmin,
        overrideAccess: false,
      })

      await expect(readUser(superAdmin.id)).resolves.toMatchObject({ id: superAdmin.id })
      await expect(readUser(other.id)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('first-login enrollment', () => {
    it('a new account gets a 72 h window, a QR after the right password, and enrolls with its code', async () => {
      const before = Date.now()
      const user = await createUser(NEW_EMAIL)
      const openUntil = new Date(user.enrollmentOpenUntil ?? 0).getTime()
      expect(openUntil - before).toBeGreaterThan(71 * 3600 * 1000)
      expect(openUntil - before).toBeLessThanOrEqual(72 * 3600 * 1000 + 5000)

      const wrongPassword = await restLogin({ email: NEW_EMAIL, password: 'not-the-password-16', enroll: true })
      expect(wrongPassword.status).toBe(401)
      const wrongBody = (await wrongPassword.json()) as { errors?: { data?: unknown }[] }
      expect(wrongBody.errors?.[0]?.data).toBeFalsy()

      const qrResponse = await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })
      expect(qrResponse.status).toBe(403)
      expect(qrResponse.headers.get('set-cookie')).toBeFalsy()
      const qrBody = (await qrResponse.json()) as { errors: { data: { otpauthUri: string; secret: string } }[] }
      const { otpauthUri, secret } = qrBody.errors[0]!.data
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//)
      expect(otpauthUri).toContain(`secret=${secret}`)

      // Same deadline -> same secret on a second request.
      const again = (await (await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })).json()) as typeof qrBody
      expect(again.errors[0]!.data.secret).toBe(secret)

      const login = await restLogin({ email: NEW_EMAIL, password: PASSWORD, totp: currentTotpCode(secret) })
      expect(login.status).toBe(200)

      const enrolled = await readUser(user.id)
      expect(enrolled.totpSecret).toBe(secret)
      expect(enrolled.totpEnabledAt).toBeTruthy()
      expect(enrolled.enrollmentOpenUntil).toBeFalsy()

      // Enrolled: no second QR.
      const closed = await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })
      expect(closed.status).toBe(401)
    })

    it('the QR response never writes the secret to the server log', async () => {
      await createUser(NEW_EMAIL)
      const logged: unknown[] = []
      const spies = (['error', 'warn', 'info'] as const).map((level) =>
        vi.spyOn(payload.logger, level).mockImplementation(((...args: unknown[]) => {
          logged.push(args)
        }) as never),
      )
      try {
        const body = (await (await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })).json()) as {
          errors: { data: { secret: string } }[]
        }
        const secret = body.errors[0]!.data.secret
        expect(secret).toBeTruthy()
        const serialized = JSON.stringify(logged, (_key, value) =>
          value instanceof Error ? { ...value, message: value.message } : value,
        )
        expect(serialized).not.toContain(secret)
      } finally {
        spies.forEach((spy) => spy.mockRestore())
      }
    })

    it('an expired window gives neither a QR nor a login', async () => {
      const user = await createUser(NEW_EMAIL)
      const qrBody = (await (await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })).json()) as {
        errors: { data: { secret: string } }[]
      }
      const secret = qrBody.errors[0]!.data.secret

      await payload.update({
        collection: 'users',
        id: user.id,
        data: { enrollmentOpenUntil: new Date(Date.now() - 1000).toISOString() },
        overrideAccess: true,
      })

      expect((await restLogin({ email: NEW_EMAIL, password: PASSWORD, enroll: true })).status).toBe(401)
      expect((await restLogin({ email: NEW_EMAIL, password: PASSWORD, totp: currentTotpCode(secret) })).status).toBe(401)
    })

    it('an account created with a secret (CLI) gets no window', async () => {
      const user = await payload.create({
        collection: 'users',
        data: { email: NEW_EMAIL, password: PASSWORD, totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' },
        overrideAccess: true,
      })
      expect((await readUser(user.id)).enrollmentOpenUntil).toBeFalsy()
    })
  })

  describe('reset 2FA endpoint', () => {
    it('a Super Admin resets another account: secret cleared, window reopened', async () => {
      const superAdmin = await createUser(SUPER_EMAIL, 'super-admin')
      const admin = await createUser(ADMIN_EMAIL)
      await enrollTotp(payload, admin.id)

      const response = await callReset(superAdmin, admin.id)
      expect(response.status).toBe(200)

      const reset = await readUser(admin.id)
      expect(reset.totpSecret).toBeFalsy()
      expect(reset.totpEnabledAt).toBeFalsy()
      expect(new Date(reset.enrollmentOpenUntil ?? 0).getTime()).toBeGreaterThan(Date.now() + 71 * 3600 * 1000)
    })

    it('an Admin cannot reset anyone, and a Super Admin cannot reset themselves', async () => {
      const superAdmin = await createUser(SUPER_EMAIL, 'super-admin')
      const admin = await createUser(ADMIN_EMAIL)

      expect((await callReset(admin, superAdmin.id)).status).toBe(403)
      expect((await callReset(superAdmin, superAdmin.id)).status).toBe(403)
    })
  })
})
