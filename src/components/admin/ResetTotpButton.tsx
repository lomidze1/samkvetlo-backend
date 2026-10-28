'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// ADR 0018 addendum C: Users sidebar action, Super Admin only and never on
// their own account (the endpoint enforces both; this just hides it).
export function ResetTotpButton() {
  const { id } = useDocumentInfo()
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  if (!id || user?.role !== 'super-admin' || String(user.id) === String(id)) return null

  const reset = async () => {
    if (!window.confirm('2FA განულდება: ძველი კოდი აღარ იმუშავებს, მომხმარებელი ყველგან გამოვა და შემდეგ შესვლისას 72 საათის განმავლობაში ახალ QR კოდს დაასკანერებს. გავაგრძელოთ?')) {
      return
    }
    setStatus('busy')
    const res = await fetch(`/api/users/${id}/reset-totp`, { method: 'POST', credentials: 'include' })
    setStatus(res.ok ? 'done' : 'error')
    if (res.ok) router.refresh()
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <button type="button" className="btn btn--style-secondary btn--size-small" onClick={reset} disabled={status === 'busy'}>
        2FA-ს განულება
      </button>
      <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
        {status === 'done'
          ? 'განულდა. შემდეგ შესვლისას ახალ QR კოდს დაასკანერებს.'
          : status === 'error'
            ? 'ვერ მოხერხდა'
            : 'დაკარგული ტელეფონი, ან QR-ის ვადა გავიდა'}
      </div>
    </div>
  )
}
