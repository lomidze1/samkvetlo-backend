import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/login'
import { seedTestUser, cleanupTestUser, resetTestUserTotp, testUser, testUserTotpSecret } from '../helpers/seedUser'
import { currentTotpCode } from '../helpers/totp'

test.describe('Admin Panel', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, user: testUser, totpSecret: testUserTotpSecret })
  })

  test.afterAll(async () => {
    await cleanupTestUser()
  })

  test('can navigate to dashboard', async () => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin$/)
    const dashboardArtifact = page.locator('span[title="Dashboard"]').first()
    await expect(dashboardArtifact).toBeVisible()
  })

  test('can navigate to list view', async () => {
    await page.goto('/admin/collections/users')
    await expect(page).toHaveURL(/\/admin\/collections\/users$/)
    const listViewArtifact = page.locator('h1', { hasText: 'Users' }).first()
    await expect(listViewArtifact).toBeVisible()
  })

  test('can navigate to edit view', async () => {
    await page.goto('/admin/collections/users/create')
    await expect(page).toHaveURL(/\/admin\/collections\/users\/[a-zA-Z0-9-_]+/)
    const editViewArtifact = page.locator('input[name="email"]')
    await expect(editViewArtifact).toBeVisible()
  })
})

// ADR 0018 §3 (T5.17): the custom TOTP login view, exercised with its own
// fresh (logged-out) browser context each time — reusing the module-level
// `page` above (already authenticated) would skip the login view entirely.
test.describe('Admin login (ADR 0018, T5.17)', () => {
  test.beforeAll(async () => {
    await seedTestUser()
  })

  test.afterAll(async () => {
    await cleanupTestUser()
  })

  test('shows 3 fields with Georgian labels', async ({ page }) => {
    await page.goto('/admin/login')
    await expect(page.locator('#field-email')).toBeVisible()
    await expect(page.locator('#field-password')).toBeVisible()
    await expect(page.locator('#field-totp')).toBeVisible()
    // ADR 0004: the admin UI stays English, except this form's labels
    // (ADR 0018 §1/§3 — a deliberate, scoped exception).
    await expect(page.getByText('ელფოსტა')).toBeVisible()
    await expect(page.getByText('პაროლი')).toBeVisible()
    await expect(page.getByText('ავთენტიფიკატორის კოდი')).toBeVisible()
  })

  test('a wrong code shows the Georgian error and stays on the login page', async ({ page }) => {
    await page.goto('/admin/login')
    await page.fill('#field-email', testUser.email)
    await page.fill('#field-password', testUser.password)
    await page.fill('#field-totp', '000000')
    await page.click('button[type="submit"]')

    await expect(page.getByText('კოდი არასწორია ან ვადაგასულია')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('a correct code logs in and ?redirect= is honored', async ({ page }) => {
    await resetTestUserTotp()
    await page.goto('/admin/login?redirect=%2Fadmin%2Fcollections%2Fusers')
    await page.fill('#field-email', testUser.email)
    await page.fill('#field-password', testUser.password)
    await page.fill('#field-totp', currentTotpCode(testUserTotpSecret))
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/admin\/collections\/users(\?.*)?$/)
  })

  test('a logged-in user visiting /admin/login is redirected away', async ({ page }) => {
    await resetTestUserTotp()
    await page.goto('/admin/login')
    await page.fill('#field-email', testUser.email)
    await page.fill('#field-password', testUser.password)
    await page.fill('#field-totp', currentTotpCode(testUserTotpSecret))
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/admin(\?.*)?$/)

    await page.goto('/admin/login')
    await expect(page).not.toHaveURL(/\/admin\/login/)
  })
})
