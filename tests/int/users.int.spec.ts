// ADR 0014 §4 (T5.9): admin hardening — lockout after 5 failed attempts and
// the >= 16 char password rule.
// @vitest-environment node
import { getPayload, LockedAuth, type Payload } from 'payload'
import config from '@/payload.config'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const EMAIL = 'users-lockout-test@samkvetlo.invalid'
const GOOD_PASSWORD = 'a-very-long-password-16'

async function resetUser(): Promise<void> {
  await payload.delete({ collection: 'users', where: { email: { equals: EMAIL } }, overrideAccess: true })
}

async function createUser(): Promise<void> {
  await payload.create({
    collection: 'users',
    data: { email: EMAIL, password: GOOD_PASSWORD },
    overrideAccess: true,
  })
}

describe('Users auth hardening (ADR 0014 §4)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    await resetUser()
  })

  it('rejects a password shorter than 16 characters with err.passwordTooShort', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: { email: EMAIL, password: 'short-pass' },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ message: 'err.passwordTooShort', status: 400 })
  })

  it('accepts a password of exactly 16 characters', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: { email: EMAIL, password: '1234567890123456' },
        overrideAccess: true,
      }),
    ).resolves.toBeTruthy()
  })

  it('locks the account on the 6th failed login attempt', async () => {
    await createUser()

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        payload.login({ collection: 'users', data: { email: EMAIL, password: 'wrong-password' } }),
      ).rejects.toThrow()
    }

    // 6th attempt: locked regardless of whether the password is now correct.
    await expect(
      payload.login({ collection: 'users', data: { email: EMAIL, password: GOOD_PASSWORD } }),
    ).rejects.toThrow(LockedAuth)
  })
})
