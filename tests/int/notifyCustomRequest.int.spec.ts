// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { notifyCustomRequestCreated } from '@/server/customRequests/notifyCustomRequest'
import { buildOwnerCustomRequestSms } from '@/server/notify/templates/customRequestCreated'
import { memoryEmailSender, memorySmsSender } from '@/server/notify/memoryAdapter'
import type { CustomRequest } from '@/payload-types'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let payload: Payload
const requestIds: (number | string)[] = []
let counter = 0

async function createRequest(overrides: Partial<CustomRequest> = {}): Promise<CustomRequest> {
  counter += 1
  const unique = `${counter}-${Date.now()}-${Math.random()}`
  const request = await payload.create({
    collection: 'custom-requests',
    data: {
      submissionId: `notify-cr-${unique}`,
      name: 'გიორგი',
      surname: 'ლომიძე',
      phone: '+995599123456',
      church: 'წმინდა გიორგის ეკლესია',
      category: 'iconostasis',
      description: 'გთხოვთ დაამზადოთ კანკელი.',
      status: 'new',
      ...overrides,
    },
    overrideAccess: true,
  })
  requestIds.push(request.id)
  return request
}

describe('notifyCustomRequestCreated (T3.7, ADR 0011 §3 / ADR 0007 §4/§6)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3011'
    process.env.EMAIL_ADAPTER = 'memory'
    process.env.SMS_ADAPTER = 'memory'
  })

  beforeEach(() => {
    memoryEmailSender.reset()
    memorySmsSender.reset()
  })

  afterEach(async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [], ownerPhones: [] },
      overrideAccess: true,
    })
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    for (const id of requestIds) {
      await payload.delete({ collection: 'custom-requests', id, overrideAccess: true }).catch(() => undefined)
    }
    delete process.env.EMAIL_ADAPTER
    delete process.env.SMS_ADAPTER
  })

  it('sends 1 owner email (category, description, contact, admin link) and 1 owner SMS — no customer channel', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner@samkvetlo.local' }], ownerPhones: [{ phone: '+995500000000' }] },
      overrideAccess: true,
    })

    const request = await createRequest()
    await notifyCustomRequestCreated(payload, request)

    expect(memoryEmailSender.sent).toHaveLength(1)
    const email = memoryEmailSender.sent[0]!
    expect(email.to).toEqual(['owner@samkvetlo.local'])
    expect(email.subject).toContain(request.number!)
    expect(email.text).toContain('კანკელი')
    expect(email.text).toContain(request.description)
    expect(email.text).toContain(`/admin/collections/custom-requests/${request.id}`)

    expect(memorySmsSender.sent).toHaveLength(1)
    const sms = memorySmsSender.sent[0]!
    expect(sms.to).toEqual(['+995500000000'])
    expect(sms.text).toContain(request.number!)

    const reloaded = await payload.findByID({ collection: 'custom-requests', id: request.id, overrideAccess: true })
    expect(reloaded.notifications).toHaveLength(2)
    expect(reloaded.notifications?.every((entry) => entry.status === 'sent')).toBe(true)
  })

  it('an adapter exception does not throw — the request keeps existing and notifications[].status = "failed"', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner@samkvetlo.local' }] },
      overrideAccess: true,
    })
    vi.spyOn(memoryEmailSender, 'send').mockRejectedValueOnce(new Error('smtp down'))

    const request = await createRequest()
    await expect(notifyCustomRequestCreated(payload, request)).resolves.toBeUndefined()

    const stillThere = await payload.findByID({ collection: 'custom-requests', id: request.id, overrideAccess: true })
    expect(stillThere.id).toBe(request.id)
    expect(stillThere.notifications).toHaveLength(1)
    expect(stillThere.notifications?.[0]).toMatchObject({ channel: 'email', status: 'failed' })
    expect(stillThere.notifications?.[0]?.error).toContain('smtp down')
  })

  it('is silent when no owner email/phone is configured', async () => {
    const request = await createRequest()
    await notifyCustomRequestCreated(payload, request)

    expect(memoryEmailSender.sent).toHaveLength(0)
    expect(memorySmsSender.sent).toHaveLength(0)
  })

  it('the owner SMS contains the request number and the contact name/phone', () => {
    const sms = buildOwnerCustomRequestSms({
      number: 'REQ-2026-000123',
      name: 'გიორგი',
      surname: 'ლომიძე',
      phone: '+995599123456',
    } as CustomRequest)
    expect(sms).toContain('REQ-2026-000123')
    expect(sms).toContain('გიორგი')
    expect(sms).toContain('599 123 456')
  })
})
