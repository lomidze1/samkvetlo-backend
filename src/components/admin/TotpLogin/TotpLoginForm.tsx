'use client'

import React from 'react'
import { EmailField, Form, FormSubmit, Link, PasswordField, TextField, useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { email as validateEmail, formatAdminURL, getSafeRedirect } from 'payload/shared'

import { ka } from '../../../i18n/ka'
import { EnrollmentQr } from './EnrollmentQr'

const baseClass = 'login__form'

export interface TotpLoginFormProps {
  redirectTo?: string
}

// ADR 0018 §3: a copy of Payload's built-in LoginForm
// (@payloadcms/next/dist/views/Login/LoginForm) with one extra field —
// `totp` — submitted in the *same* POST as email/password, since
// requireTotp.ts reads it off `req.data` in the same login request. Our
// Users collection never enables username login, so (unlike the original)
// this only ever renders the email variant.
function validateTotpCode(value: unknown): string | true {
  if (typeof value === 'string' && /^\d{6}$/.test(value)) return true
  return ka.server.security.totp.invalidCode
}

export const TotpLoginForm: React.FC<TotpLoginFormProps> = ({ redirectTo }) => {
  const { config } = useConfig()
  const {
    admin: {
      routes: { forgot: forgotRoute },
      user: userSlug,
    },
    routes: { admin: adminRoute, api: apiRoute },
  } = config
  const { t } = useTranslation()
  const { setUser } = useAuth()

  const handleLogin = React.useCallback(
    (data: unknown) => {
      setUser(data as Parameters<typeof setUser>[0])
    },
    [setUser],
  )

  return (
    <Form
      action={formatAdminURL({ apiRoute, path: `/${userSlug}/login` })}
      className={baseClass}
      disableSuccessStatus
      initialState={{
        email: { valid: true, value: undefined },
        password: { valid: true, value: undefined },
        totp: { valid: true, value: undefined },
      }}
      method="POST"
      onSuccess={handleLogin}
      redirect={getSafeRedirect({ fallbackTo: adminRoute, redirectTo: redirectTo ?? '' })}
      waitForAutocomplete
    >
      <div className={`${baseClass}__inputWrap`}>
        <EmailField
          field={{
            name: 'email',
            admin: { autoComplete: 'email' },
            label: ka.server.security.totp.loginEmailLabel,
            required: true,
          }}
          path="email"
          validate={validateEmail}
        />
        <PasswordField
          field={{ name: 'password', label: ka.server.security.totp.loginPasswordLabel, required: true }}
          path="password"
        />
        <TextField
          field={{
            name: 'totp',
            admin: { autoComplete: 'one-time-code' },
            label: ka.server.security.totp.loginCodeLabel,
            maxLength: 6,
            required: true,
          }}
          path="totp"
          validate={validateTotpCode}
        />
        <EnrollmentQr loginUrl={formatAdminURL({ apiRoute, path: `/${userSlug}/login` })} />
      </div>
      <Link href={formatAdminURL({ adminRoute, path: forgotRoute })} prefetch={false}>
        {t('authentication:forgotPasswordQuestion')}
      </Link>
      <FormSubmit size="large">{t('authentication:login')}</FormSubmit>
    </Form>
  )
}
