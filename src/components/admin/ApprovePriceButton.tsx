'use client'

import { Button, toast, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

// ADR 0006 (approval workflow), T1.4: the only UI that calls
// POST /api/costings/:id/approve. Sidebar field on the Costings edit view.
const INDICATOR_EMOJI: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
}

export function ApprovePriceButton() {
  const { data, id } = useDocumentInfo()
  const [priceInput, setPriceInput] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  if (!id) {
    return <div style={{ fontSize: 13, opacity: 0.75 }}>ჯერ შეინახეთ კალკულაცია.</div>
  }

  const indicator = data?.indicator as string | undefined
  const suggested = data?.suggestedPriceGel as number | undefined
  const proposed = (data?.proposedPriceGel as number | undefined) ?? suggested
  const approvedAt = data?.approvedAt as string | undefined
  const price = priceInput !== '' ? Number(priceInput) : proposed
  const needsOverride = indicator === 'red'

  async function handleApprove() {
    if (!price || !Number.isFinite(price) || price <= 0) {
      toast.error('ფასი სავალდებულოა და დადებითი რიცხვი უნდა იყოს')
      return
    }
    if (needsOverride && !reason.trim()) {
      toast.error('🔴 override-ისთვის მიზეზი სავალდებულოა')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/costings/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          price,
          overrideRed: needsOverride ? true : undefined,
          reason: needsOverride ? reason.trim() : undefined,
        }),
      })
      const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
      if (!res.ok) {
        toast.error(json?.error?.code ?? 'დადასტურება ჩავარდა')
        return
      }
      toast.success('ფასი დადასტურდა')
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        ინდიკატორი: {indicator ? INDICATOR_EMOJI[indicator] ?? indicator : '—'}
        {typeof suggested === 'number' ? ` · შემოთავაზებული ${suggested} ₾` : null}
      </div>
      <div>
        <label htmlFor="approve-price-input" style={{ display: 'block', marginBottom: 4 }}>
          დასადასტურებელი ფასი (₾)
        </label>
        <input
          id="approve-price-input"
          type="number"
          min={1}
          value={priceInput !== '' ? priceInput : proposed ?? ''}
          onChange={(event) => setPriceInput(event.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      {needsOverride ? (
        <div>
          <label htmlFor="approve-reason-input" style={{ display: 'block', marginBottom: 4 }}>
            მიზეზი (🔴 override სავალდებულოა)
          </label>
          <input
            id="approve-reason-input"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      ) : null}
      <Button buttonStyle="primary" disabled={loading} onClick={handleApprove} size="medium">
        {loading ? 'დადასტურდება…' : 'დადასტურება'}
      </Button>
      {approvedAt ? (
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          ბოლო დადასტურება: {new Date(approvedAt).toLocaleString('ka-GE')}
        </div>
      ) : null}
    </div>
  )
}
