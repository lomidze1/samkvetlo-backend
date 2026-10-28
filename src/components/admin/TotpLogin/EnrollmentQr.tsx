'use client'

import React from 'react'
import { useForm } from '@payloadcms/ui'
import { toDataURL } from 'qrcode'

// ADR 0018 addendum C: first login of an account a Super Admin created in
// the admin. Sends the same login request with `enroll: true`; requireTotp
// answers (only after a correct password, only while the account has no
// secret and its window is open) with the otpauth URI, rendered here as a
// QR code locally — the secret never goes to a third-party QR service.
export function EnrollmentQr({ loginUrl }: { loginUrl: string }) {
  const { getData } = useForm()
  const [qr, setQr] = React.useState<{ image: string; secret: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const showQr = async () => {
    setError(null)
    const { email, password } = getData() as { email?: string; password?: string }
    if (!email || !password) {
      setError('ჯერ ელფოსტა და პაროლი შეიყვანეთ')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(loginUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, enroll: true }),
      })
      const json = (await res.json()) as { errors?: { data?: { otpauthUri?: string; secret?: string }; message?: string }[] }
      const data = json.errors?.[0]?.data
      if (data?.otpauthUri && data.secret) {
        setQr({ image: await toDataURL(data.otpauthUri, { margin: 1, width: 220 }), secret: data.secret })
      } else {
        setError(json.errors?.[0]?.message ?? 'QR კოდის მიღება ვერ მოხერხდა')
      }
    } finally {
      setLoading(false)
    }
  }

  if (qr) {
    return (
      <div className="enrollment-qr">
        <p>
          1. ტელეფონზე გახსენით Google Authenticator → „+“ → „Scan a QR code“ და დაასკანერეთ.
          <br />
          2. ზემოთ, „ავთენტიფიკატორის კოდში“ ჩაწერეთ აპის 6 ციფრი და დააჭირეთ Login.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        <img src={qr.image} alt="2FA QR კოდი" width={220} height={220} />
        <p className="enrollment-qr__secret">
          თუ სკანერება ვერ ხერხდება, „Enter a setup key“ → Time based:
          <br />
          <code>{qr.secret}</code>
        </p>
      </div>
    )
  }

  return (
    <div className="enrollment-qr">
      <button type="button" className="enrollment-qr__button" onClick={showQr} disabled={loading}>
        პირველად შედიხართ? QR კოდის ჩვენება
      </button>
      {error && <p className="enrollment-qr__error">{error}</p>}
    </div>
  )
}
