import type { AdminViewServerProps } from 'payload'

import { redirect } from 'next/navigation'
import { getSafeRedirect } from 'payload/shared'
import React from 'react'

import { TotpLoginForm } from './TotpLoginForm'

// ADR 0018 §3: replaces the built-in `login` admin view
// (`admin.components.views.login.Component`), the way `getCustomViewByKey`
// picks it up — it takes over the *whole* view, not just the form, so it
// re-implements the redirect-when-already-logged-in check the original
// LoginView does. It skips the built-in view's brand/logo header, which
// ADR 0018 doesn't call for.
export function TotpLoginView({ initPageResult, searchParams }: AdminViewServerProps): React.JSX.Element {
  const {
    req: { payload, user },
  } = initPageResult
  const {
    routes: { admin },
  } = payload.config

  const redirectTo = typeof searchParams?.redirect === 'string' ? searchParams.redirect : undefined
  if (user) {
    redirect(getSafeRedirect({ fallbackTo: admin, redirectTo: redirectTo ?? '' }))
  }

  return <TotpLoginForm redirectTo={redirectTo} />
}
