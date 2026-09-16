// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { notifyOrderCreated } from '@/server/orders/notifyOrder'
import { buildCustomerOrderText, buildOwnerOrderSms } from '@/server/notify/templates/orderCreated'
import { memoryEmailSender, memorySmsSender } from '@/server/notify/memoryAdapter'
import type { Order } from '@/payload-types'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let payload: Payload
const orderIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const productIds: (number | string)[] = []
let counter = 0

async function createOrder(overrides: Partial<Order> = {}): Promise<Order> {
  counter += 1
  const unique = `${counter}-${Date.now()}-${Math.random()}`
  const category = await payload.create({ collection: 'categories', data: { name: `notify-კატ ${unique}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `notify-პროდუქტი ${unique}`,
      category: category.id,
      tier: 'standard',
      description: {
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
              children: [{ type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const }],
            },
          ],
        },
      },
    },
  })
  productIds.push(product.id)
  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  const variantId = variants[0]!.id

  const order = await payload.create({
    collection: 'orders',
    data: {
      submissionId: `notify-sub-${unique}`,
      name: 'გიორგი',
      surname: 'ლომიძე',
      phone: '+995599123456',
      church: 'წმინდა გიორგის ეკლესია',
      items: [
        {
          variant: variantId,
          productTitle: product.title,
          variantTitle: 'სტანდარტული',
          sku: 'SMK-000001',
          unitPrice: 1000,
          qty: 2,
        },
      ],
      deliveryZone: { slug: 'kakheti', name: 'კახეთი' },
      deliveryFeeGel: 200,
      status: 'new',
      ...overrides,
    },
    overrideAccess: true,
  })
  orderIds.push(order.id)
  return order
}

describe('notifyOrderCreated (T3.4, ADR 0007 §4/§6)', () => {
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
      data: { ownerEmails: [], ownerPhones: [], notifyCustomer: false },
      overrideAccess: true,
    })
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    for (const id of orderIds) await payload.delete({ collection: 'orders', id, overrideAccess: true }).catch(() => undefined)
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
    delete process.env.EMAIL_ADAPTER
    delete process.env.SMS_ADAPTER
  })

  it('sends 1 owner email (number, lines, zone + fee, total via formatGel, admin link) and 1 owner SMS <= 140 chars', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner@samkvetlo.local' }], ownerPhones: [{ phone: '+995500000000' }] },
      overrideAccess: true,
    })

    const order = await createOrder()
    await notifyOrderCreated(payload, order)

    expect(memoryEmailSender.sent).toHaveLength(1)
    const email = memoryEmailSender.sent[0]!
    expect(email.to).toEqual(['owner@samkvetlo.local'])
    expect(email.subject).toContain(order.number!)
    expect(email.text).toContain('კახეთი')
    expect(email.text).toContain('200')
    expect(email.text).toContain('2 000')
    expect(email.text).toContain(`/admin/collections/orders/${order.id}`)

    expect(memorySmsSender.sent).toHaveLength(1)
    const sms = memorySmsSender.sent[0]!
    expect(sms.to).toEqual(['+995500000000'])
    expect(sms.text).toContain(order.number!)
    expect(sms.text.length).toBeLessThanOrEqual(140)

    const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })
    expect(reloaded.notifications).toHaveLength(2)
    expect(reloaded.notifications?.every((entry) => entry.status === 'sent')).toBe(true)
  })

  it('an adapter exception does not throw — the order keeps existing and notifications[].status = "failed"', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner@samkvetlo.local' }] },
      overrideAccess: true,
    })
    vi.spyOn(memoryEmailSender, 'send').mockRejectedValueOnce(new Error('smtp down'))

    const order = await createOrder()
    await expect(notifyOrderCreated(payload, order)).resolves.toBeUndefined()

    const stillThere = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })
    expect(stillThere.id).toBe(order.id)
    expect(stillThere.notifications).toHaveLength(1)
    expect(stillThere.notifications?.[0]).toMatchObject({ channel: 'email', status: 'failed' })
    expect(stillThere.notifications?.[0]?.error).toContain('smtp down')
  })

  it('the customer channel is silent when notifyCustomer is false (default)', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner@samkvetlo.local' }], notifyCustomer: false },
      overrideAccess: true,
    })
    const order = await createOrder({ email: 'customer@samkvetlo.invalid' })
    await notifyOrderCreated(payload, order)

    expect(memoryEmailSender.sent.every((message) => !message.to.includes('customer@samkvetlo.invalid'))).toBe(true)
  })

  it('the customer channel fires (SMS always, email when order.email is set) when notifyCustomer is true', async () => {
    await payload.updateGlobal({ slug: 'site-settings', data: { notifyCustomer: true }, overrideAccess: true })
    const order = await createOrder({ email: 'customer@samkvetlo.invalid' })
    await notifyOrderCreated(payload, order)

    expect(memorySmsSender.sent.some((message) => message.to.includes(order.phone))).toBe(true)
    expect(memoryEmailSender.sent.some((message) => message.to.includes('customer@samkvetlo.invalid'))).toBe(true)
  })

  it('D17: the customer template is <= 140 chars', () => {
    const text = buildCustomerOrderText({ number: 'SMK-2026-000123' } as Order)
    expect(text.length).toBeLessThanOrEqual(140)
    expect(text).toContain('SMK-2026-000123')
  })

  it('the owner SMS matches the ADR 0007 §4 shape: number · total · name initial. · phone', () => {
    const order = { number: 'SMK-2026-000123', totalGel: 7610, name: 'გიორგი', surname: 'ლომიძე', phone: '+995599123456' } as Order
    const sms = buildOwnerOrderSms(order)
    expect(sms).toBe('ახალი შეკვეთა SMK-2026-000123 · 7 610 ₾ · გიორგი ლ. · 599 123 456')
  })
})
