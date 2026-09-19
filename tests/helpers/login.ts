import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { currentTotpCode } from './totp.js'

export interface LoginOptions {
  page: Page
  user: {
    email: string
    password: string
  }
  /** ADR 0018 (T5.17): base32 TOTP secret — see tests/helpers/seedUser.ts's testUserTotpSecret. */
  totpSecret: string
}

/**
 * Logs the user into the admin panel via the login page. Uses relative
 * paths so it works against whatever `use.baseURL` playwright.config.ts is
 * pointed at (E2E_BACKEND_URL) instead of a hardcoded port.
 */
export async function login({ page, user, totpSecret }: LoginOptions): Promise<void> {
  await page.goto('/admin/login')

  await page.fill('#field-email', user.email)
  await page.fill('#field-password', user.password)
  await page.fill('#field-totp', currentTotpCode(totpSecret))
  await page.click('button[type="submit"]')

  await page.waitForURL(/\/admin(\?.*)?$/)

  const dashboardArtifact = page.locator('span[title="Dashboard"]')
  await expect(dashboardArtifact).toBeVisible()
}
