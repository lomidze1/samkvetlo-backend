// @vitest-environment node
import { getPayload, type AccessArgs, type Payload } from 'payload'
import config from '@/payload.config'

import { Orders } from '@/collections/Orders'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const orderIds: (number | string)[] = []
const userIds: (number | string)[] = []
const cleanupFns: Array<() => Promise<void>> = []

const anonymousAccess = { req: { user: null } } as unknown as AccessArgs

function baseOrderData(submissionId: string, variantId: number) {
  return {
    submissionId,
    name: 'გიორგი',
    surname: 'ლომიძე',
    phone: '+995500000000',
    church: 'წმინდა გიორგის ეკლესია',
    items: [
      {
        variant: variantId,
        productTitle: 'საეკლესიო ზარი',
        variantTitle: 'სტანდარტული',
        sku: 'SMK-000001',
        unitPrice: 1000,
        qty: 2,
      },
    ],
    deliveryZone: { slug: 'tbilisi', name: 'თბილისი' },
    deliveryFeeGel: 0,
    status: 'new' as const,
  }
}

async function createVariant(): Promise<number> {
  const category = await payload.create({
    collection: 'categories',
    data: { name: `შეკვეთის-კატ ${Date.now()}-${Math.random()}` },
  })
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `შეკვეთის პროდუქტი ${Date.now()}-${Math.random()}`,
      category: category.id,
      tier: 'standard',
      description: {
        root: {
          type: 'root',
          direction: null,
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'paragraph',
              direction: null,
              format: '',
              indent: 0,
              version: 1,
              children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text: 'x', version: 1 }],
            },
          ],
        },
      },
    },
  })
  const { docs: variants } = await payload.find({
    collection: 'variants',
    where: { product: { equals: product.id } },
  })
  const variant = variants[0]!

  cleanupFns.push(async () => {
    await payload.delete({ collection: 'variants', id: variant.id }).catch(() => undefined)
    await payload.delete({ collection: 'products', id: product.id }).catch(() => undefined)
    await payload.delete({ collection: 'categories', id: category.id }).catch(() => undefined)
  })

  return variant.id
}

describe('orders collection (T1.7, ADR 0003/0005/0015, ADR 0014 §12)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of orderIds) await payload.delete({ collection: 'orders', id, overrideAccess: true }).catch(() => undefined)
    for (const id of userIds) await payload.delete({ collection: 'users', id }).catch(() => undefined)
    for (const fn of cleanupFns) await fn()
  })

  it('the status field does not offer "installed" (D16) and ends at "cancelled"', () => {
    const statusField = Orders.fields.find(
      (field) => 'name' in field && field.name === 'status',
    ) as { options: Array<{ value: string }> }
    const values = statusField.options.map((option) => option.value)
    expect(values).not.toContain('installed')
    expect(values).toContain('delivered')
    expect(values[values.length - 1]).toBe('cancelled')
  })

  it('anonymous create is forbidden — an Order is only ever written by the future submitOrder endpoint (T3.3)', async () => {
    expect(await Orders.access!.create!(anonymousAccess)).toBe(false)
  })

  it('there is no _orders_v versions table (D25: no drafts/versions keeping old PII)', async () => {
    const pool = (payload.db as unknown as { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }).pool
    const result = await pool.query("select to_regclass('_orders_v') as reg")
    expect((result.rows[0] as { reg: string | null }).reg).toBeNull()
  })

  it('creating an order computes lineTotal/itemsTotalGel/totalGel, an order number, and statusChangedAt = createdAt', async () => {
    const variantId = await createVariant()
    const order = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    orderIds.push(order.id)

    expect(order.number).toMatch(/^SMK-\d{4}-\d{6}$/)
    expect(order.items[0]?.lineTotal).toBe(2000)
    expect(order.itemsTotalGel).toBe(2000)
    expect(order.totalGel).toBe(2000)
    expect(order.status).toBe('new')
    expect(order.statusChangedAt).toBeTruthy()
    // Default = createdAt (ADR 0003 §8) — computed a beat apart in the same
    // request, so compare within a tolerance rather than exact equality.
    expect(
      Math.abs(new Date(order.statusChangedAt!).getTime() - new Date(order.createdAt).getTime()),
    ).toBeLessThan(2000)
  })

  it('changing status appends statusHistory (from/to/by/at) and updates statusChangedAt', async () => {
    const variantId = await createVariant()
    const order = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    orderIds.push(order.id)

    const admin = await payload.create({
      collection: 'users',
      data: { email: `orders-admin-${Date.now()}@samkvetlo.local`, password: 'test-password' },
    })
    userIds.push(admin.id)

    const originalChangedAt = order.statusChangedAt

    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      data: { status: 'contacted' },
      overrideAccess: true,
      user: admin,
      depth: 0,
    })

    expect(updated.status).toBe('contacted')
    expect(updated.statusHistory).toHaveLength(1)
    expect(updated.statusHistory?.[0]).toMatchObject({ from: 'new', to: 'contacted', by: admin.id })
    expect(updated.statusChangedAt).not.toBe(originalChangedAt)
  })

  it('a duplicate submissionId is a unique-constraint violation', async () => {
    const variantId = await createVariant()
    const submissionId = `sub-dup-${Date.now()}-${Math.random()}`

    const order1 = await payload.create({
      collection: 'orders',
      data: baseOrderData(submissionId, variantId),
      overrideAccess: true,
    })
    orderIds.push(order1.id)

    await expect(
      payload.create({ collection: 'orders', data: baseOrderData(submissionId, variantId), overrideAccess: true }),
    ).rejects.toBeTruthy()
  })

  it('deliveryFeeGel cannot be changed by a normal (non-overrideAccess) update', async () => {
    const variantId = await createVariant()
    const order = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    orderIds.push(order.id)

    const admin = await payload.create({
      collection: 'users',
      data: { email: `orders-admin2-${Date.now()}@samkvetlo.local`, password: 'test-password' },
    })
    userIds.push(admin.id)

    await payload.update({
      collection: 'orders',
      id: order.id,
      data: { deliveryFeeGel: 999 },
      overrideAccess: false,
      user: admin,
    })

    const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })
    expect(reloaded.deliveryFeeGel).not.toBe(999)
  })
})
