import { getPayload } from 'payload'
import config from '../../src/payload.config.js'
import { enrollTotp, resetTotpLastStep } from './totp.js'

export const testUser = {
  email: 'dev@payloadcms.com',
  // ADR 0014 §4 (T5.9): >= 16 chars, enforced by the beforeValidate hook.
  password: 'e2e-test-password-16',
}

// ADR 0018 (T5.17): filled in by seedTestUser() — the login helper needs it
// to generate a code for the same request as the password.
export let testUserTotpSecret = ''

/**
 * Seeds a test user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  // Delete existing test user if any
  await payload.delete({
    collection: 'users',
    where: {
      email: {
        equals: testUser.email,
      },
    },
  })

  // Create fresh test user
  // ADR 0018 addendum C: the e2e admin tests manage users, so Super Admin.
  const user = await payload.create({
    collection: 'users',
    data: { ...testUser, role: 'super-admin' },
  })
  testUserTotpSecret = await enrollTotp(payload, user.id)
}

/**
 * ADR 0018 (T5.17): clears the TOTP replay guard so an e2e test can submit
 * a freshly-generated code and log in again within the same 30 s step
 * another test already used.
 */
export async function resetTestUserTotp(): Promise<void> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: testUser.email } },
    limit: 1,
    overrideAccess: true,
  })
  const user = docs[0]
  if (user) await resetTotpLastStep(payload, user.id)
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'users',
    where: {
      email: {
        equals: testUser.email,
      },
    },
  })
}
