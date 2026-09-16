// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

describe('site-settings global (T1.5, ADR 0005 layer 2 / ADR 0007)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        phone: '+995500000000',
        email: 'info@samkvetlo.ge',
        ownerEmails: [{ email: 'owner@samkvetlo.local' }],
        ownerPhones: [{ phone: '+995511111111' }],
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [], ownerPhones: [] },
      overrideAccess: true,
    })
  })

  it('an anonymous read gets the public fields but not ownerEmails/ownerPhones/notifyCustomer/shareLinkTtlDays', async () => {
    const settings = await payload.findGlobal({
      slug: 'site-settings',
      overrideAccess: false,
      user: null,
    })

    expect(settings.phone).toBe('+995500000000')
    expect(settings.email).toBe('info@samkvetlo.ge')
    // Inaccessible array fields come back as [] (not removed), inaccessible
    // scalars come back as undefined — either way, no owner data leaks.
    expect(settings.ownerEmails ?? []).toEqual([])
    expect(settings.ownerPhones ?? []).toEqual([])
    expect(settings.notifyCustomer).toBeUndefined()
    expect(settings.shareLinkTtlDays).toBeUndefined()
    expect(JSON.stringify(settings)).not.toContain('owner@samkvetlo.local')
    expect(JSON.stringify(settings)).not.toContain('+995511111111')
  })

  it('an admin read includes ownerEmails/ownerPhones', async () => {
    const admin = await payload.create({
      collection: 'users',
      data: { email: `site-settings-admin-${Date.now()}@samkvetlo.local`, password: 'test-password-16chars' },
    })
    try {
      const settings = await payload.findGlobal({
        slug: 'site-settings',
        overrideAccess: false,
        user: admin,
      })
      expect(settings.ownerEmails).toMatchObject([{ email: 'owner@samkvetlo.local' }])
    } finally {
      await payload.delete({ collection: 'users', id: admin.id, overrideAccess: true })
    }
  })

  it('configuratorEnabled defaults to false', async () => {
    const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
    expect(settings.configuratorEnabled).toBe(false)
  })
})
