import { test, expect, type Page } from '@playwright/test'
import { getPayload, type Payload } from 'payload'
import config from '../../src/payload.config.js'

import { login } from '../helpers/login.js'
import { seedTestUser, cleanupTestUser, testUser, testUserTotpSecret } from '../helpers/seedUser.js'

// M8 (_doc/plan/implementation-plan.md): the owner's three daily admin
// scenarios. One TOTP login for the whole file (module-level `page`,
// storageState-less — same pattern as tests/e2e/admin.e2e.spec.ts's first
// describe) so we never re-submit a code within the same 30 s step.
//
// Status changes are verified against the DB via the Local API rather than
// a save toast: Payload's toast auto-dismisses (and, on the approve
// button, a `window.location.reload()` follows it almost immediately), so
// waiting on transient toast text was flaky. `#action-save` becoming
// disabled again is used only as a synchronization point (Payload clears
// the dirty flag once the save round-trip completes) — the PATCH's 200
// response and this test's own `getPayload()` Local API connection are two
// separate Postgres sessions, and `expectStatus` below polls rather than
// reading once immediately after, since a single immediate read has been
// observed to still see the pre-commit row.

const EMPTY_RICH_TEXT = {
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
        children: [
          { type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const },
        ],
      },
    ],
  },
}

let payload: Payload
let page: Page

const cleanup: Array<() => Promise<void>> = []

async function createVariant(label: string) {
  const category = await payload.create({ collection: 'categories', data: { name: `M8-კატ-${label}-${Date.now()}` } })
  const product = await payload.create({
    collection: 'products',
    data: { title: `M8-პროდუქტი-${label}-${Date.now()}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
  })
  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  const variant = variants[0]!
  cleanup.push(async () => {
    await payload.delete({ collection: 'costings', where: { variant: { equals: variant.id } } }).catch(() => undefined)
    await payload.delete({ collection: 'variants', where: { product: { equals: product.id } } }).catch(() => undefined)
    await payload.delete({ collection: 'products', id: product.id }).catch(() => undefined)
    await payload.delete({ collection: 'categories', id: category.id }).catch(() => undefined)
  })
  return variant
}

/** Opens the status <select> (react-select), picks `label`, saves, and
 * waits for the save round-trip to finish (Save button re-disables). */
async function setStatusViaUi(url: string, label: string) {
  await page.goto(url)
  await page.locator('#field-status .rs__control').click()
  await page.locator('.rs__option', { hasText: label }).click()
  // The click above updates react-select's internal form state a tick
  // after the DOM commit — clicking Save before that state flushes saves
  // the *previous* value. Waiting for the visible selection to match first
  // makes this a real synchronization point, not a guess.
  await expect(page.locator('#field-status .rs__single-value')).toHaveText(label)
  await page.locator('#action-save').click()
  await expect(page.locator('#action-save')).toBeDisabled({ timeout: 10_000 })
}

/** Polls the Local API for `status` (see the file-level comment above). */
async function expectStatus(
  collection: 'orders' | 'custom-requests',
  id: number | string,
  status: string,
): Promise<void> {
  await expect
    .poll(async () => (await payload.findByID({ collection, id })).status, { timeout: 5_000 })
    .toBe(status)
}

test.describe('Owner daily workflow (M8)', () => {
  test.beforeAll(async ({ browser }) => {
    payload = await getPayload({ config })
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()
    await login({ page, user: testUser, totpSecret: testUserTotpSecret })
  })

  test.afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn()
    await cleanupTestUser()
  })

  // --- (ა) Order lifecycle: new → paid → ordered-from-supplier → in-transit → delivered ---
  test('order status walks new → paid → ordered-from-supplier → in-transit → delivered, with history', async () => {
    const variant = await createVariant('order')
    const order = await payload.create({
      collection: 'orders',
      data: {
        submissionId: `m8-${Date.now()}-${Math.random()}`,
        name: 'გიორგი',
        surname: 'ლომიძე',
        phone: '+995500000001',
        church: 'M8-TEST-CHURCH',
        internalNotes: 'M8-TEST-INTERNAL-NOTE',
        supplierOrderNo: 'M8-TEST-SUPPLIER-ORDER-NO',
        items: [
          {
            variant: variant.id,
            productTitle: 'M8 პროდუქტი',
            variantTitle: 'სტანდარტული',
            sku: 'SMK-M8-0001',
            unitPrice: 1000,
            qty: 1,
          },
        ],
        deliveryZone: { slug: 'tbilisi', name: 'თბილისი' },
        deliveryFeeGel: 0,
        status: 'new',
      },
    })
    cleanup.push(async () => {
      await payload.delete({ collection: 'orders', id: order.id }).catch(() => undefined)
    })

    const transitions = ['paid', 'ordered-from-supplier', 'in-transit', 'delivered'] as const
    for (const status of transitions) {
      await setStatusViaUi(`/admin/collections/orders/${order.id}`, STATUS_LABELS[status])
      await expectStatus('orders', order.id, status)
    }

    const finalDoc = await payload.findByID({ collection: 'orders', id: order.id })
    expect(finalDoc.status).toBe('delivered')
    expect(finalDoc.statusHistory?.map((h) => h.to)).toEqual(transitions)
    // The save above shouldn't surface a false "failed notification" banner.
    await expect(page.locator('text=⚠').first()).not.toBeVisible()

    // List view (default columns/sort, M8 fix): newest first, no
    // supplier/internal-only fields leaked into the row.
    await page.goto('/admin/collections/orders')
    const firstRow = page.locator('table tbody tr').first()
    await expect(firstRow).toContainText(order.number ?? '')
    const listText = await page.locator('table').innerText()
    expect(listText).not.toContain('M8-TEST-INTERNAL-NOTE')
    expect(listText).not.toContain('M8-TEST-SUPPLIER-ORDER-NO')
  })

  // --- (ბ) Price confirmation: which variant is waiting, one click to approve ---
  test('an unapproved costing surfaces first in the list and is approved in one click', async () => {
    const variant = await createVariant('price')
    const supplier = await payload.create({ collection: 'suppliers', data: { name: 'M8-TEST-SUPPLIER' } })
    cleanup.push(async () => {
      await payload.delete({ collection: 'suppliers', id: supplier.id }).catch(() => undefined)
    })
    const costing = await payload.create({
      collection: 'costings',
      data: {
        variant: variant.id,
        supplier: supplier.id,
        costRub: 50_000,
        logisticsGel: 100,
        proposedPriceGel: 1500,
      },
    })
    cleanup.push(async () => {
      await payload.delete({ collection: 'costings', id: costing.id }).catch(() => undefined)
    })
    expect(costing.approvedAt).toBeFalsy()

    // List: default sort puts the unapproved costing (approvedAt = null,
    // '-approvedAt' → NULLS FIRST) at the top, with the columns needed to
    // spot it visible without opening the record.
    await page.goto('/admin/collections/costings')
    const headerText = await page.locator('table thead').innerText()
    expect(headerText).toMatch(/approvedAt|დადასტურ/i)
    const firstDataRow = page.locator('table tbody tr').first()
    await expect(firstDataRow).toContainText('M8-TEST-SUPPLIER')

    // supplierUrl/supplierSku/costRub/notes are not defaultColumns — the
    // list view must not show them even though supplier itself is a
    // legitimate column for this admin-only collection.
    const listTextBefore = await page.locator('table').innerText()
    expect(listTextBefore).not.toContain('50 000')
    expect(listTextBefore).not.toContain('50,000')

    // One click (+ one price entry) to approve.
    await page.goto(`/admin/collections/costings/${costing.id}`)
    await page.getByLabel(/დასადასტურებელი ფასი/).fill('1500')
    // The button reloads the page on success (ApprovePriceButton.tsx) —
    // wait for the reload's 'load' event, not the transient toast (which
    // the reload usually wipes out before an assertion can see it) and not
    // waitForURL (the URL doesn't change, so it resolves immediately
    // without actually waiting for the reload).
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'დადასტურება', exact: true }).click(),
    ])
    await expect(page.getByText(/ბოლო დადასტურება/)).toBeVisible({ timeout: 10_000 })

    await expect
      .poll(async () => (await payload.findByID({ collection: 'costings', id: costing.id })).approvedAt, {
        timeout: 5_000,
      })
      .toBeTruthy()
  })

  // --- (გ) Custom request: contacted → quoted → closed (lost) ---
  test('a custom request walks new → contacted → quoted → lost, with history', async () => {
    const request = await payload.create({
      collection: 'custom-requests',
      data: {
        submissionId: `m8-cr-${Date.now()}-${Math.random()}`,
        name: 'თამარ',
        surname: 'ბერიძე',
        phone: '+995500000002',
        church: 'M8-CR-TEST-CHURCH',
        category: 'other',
        description: 'M8-TEST-DESCRIPTION',
        internalNotes: 'M8-TEST-CR-INTERNAL-NOTE',
        status: 'new',
      },
    })
    cleanup.push(async () => {
      await payload.delete({ collection: 'custom-requests', id: request.id }).catch(() => undefined)
    })

    const transitions = ['contacted', 'quoted', 'lost'] as const
    for (const status of transitions) {
      await setStatusViaUi(`/admin/collections/custom-requests/${request.id}`, CUSTOM_REQUEST_STATUS_LABELS[status])
      await expectStatus('custom-requests', request.id, status)
    }

    const finalDoc = await payload.findByID({ collection: 'custom-requests', id: request.id })
    expect(finalDoc.status).toBe('lost')
    expect(finalDoc.statusHistory?.map((h) => h.to)).toEqual(transitions)

    // List view: newest first (M8 fix), no PII/internal-notes leak.
    await page.goto('/admin/collections/custom-requests')
    const firstRow = page.locator('table tbody tr').first()
    await expect(firstRow).toContainText(request.number ?? '')
    const listText = await page.locator('table').innerText()
    expect(listText).not.toContain('M8-TEST-CR-INTERNAL-NOTE')
  })
})

const STATUS_LABELS: Record<string, string> = {
  new: 'ახალი',
  contacted: 'დაკავშირებული',
  confirmed: 'დადასტურებული',
  paid: 'გადახდილი',
  'ordered-from-supplier': 'შეკვეთილია მომწოდებელთან',
  'in-transit': 'გზაში',
  delivered: 'მიწოდებული',
  cancelled: 'გაუქმებული',
}

const CUSTOM_REQUEST_STATUS_LABELS: Record<string, string> = {
  new: 'ახალი',
  contacted: 'დაკავშირებული',
  quoted: 'შეფასებული',
  won: 'მოგებული',
  lost: 'წაგებული',
}
