'use client'

import { Button, toast, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

// ADR 0014 §12 (D25) / T5.12: manual "ანონიმიზაცია" action — the admin-side
// equivalent of a data-subject deletion request, before the 2-year cron
// would have gotten to it. Shared by Orders and CustomRequests (both point
// their sidebar `ui` field at this same component); `collectionSlug` picks
// which REST path (POST /api/{orders|custom-requests}/:id/anonymize,
// src/endpoints/anonymize.ts) to call.
export function AnonymizeButton() {
  const { id, collectionSlug, data } = useDocumentInfo()
  const [loading, setLoading] = useState(false)

  if (!id || !collectionSlug) {
    return <div style={{ fontSize: 13, opacity: 0.75 }}>ჯერ შეინახეთ ჩანაწერი.</div>
  }

  const anonymizedAt = data?.anonymizedAt as string | undefined

  async function handleAnonymize() {
    if (!window.confirm('ანონიმიზაცია შეუქცევადია — სახელი, გვარი, ტელეფონი, ეკლესია, ელფოსტა და კომენტარი/აღწერა წაიშლება. გავაგრძელოთ?')) {
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/${collectionSlug}/${id}/anonymize`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = (await res.json().catch(() => null)) as { errors?: { message?: string }[] } | null
      if (!res.ok) {
        toast.error(json?.errors?.[0]?.message ?? 'ანონიმიზაცია ჩავარდა')
        return
      }
      toast.success('ანონიმიზდა')
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button buttonStyle="secondary" disabled={loading || Boolean(anonymizedAt)} onClick={handleAnonymize} size="medium">
        {loading ? 'მიმდინარეობს…' : anonymizedAt ? 'ანონიმიზებულია' : 'ანონიმიზაცია'}
      </Button>
      {anonymizedAt ? (
        <div style={{ fontSize: 12, opacity: 0.75 }}>{new Date(anonymizedAt).toLocaleString('ka-GE')}</div>
      ) : null}
    </div>
  )
}
