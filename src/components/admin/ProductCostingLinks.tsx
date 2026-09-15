'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

// ADR 0006 §"− ფასი ორ ეკრანზეა" mitigation, T1.4: Products sidebar link to
// each variant's costing, showing suggested ↔ current price + 🟢🟡🔴.
const INDICATOR_EMOJI: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
}

type VariantDoc = { id: number | string; price?: number | null; title?: string | null }
type CostingDoc = {
  id: number | string
  indicator?: 'green' | 'red' | 'yellow' | null
  suggestedPriceGel?: number | null
}
type Row = {
  costing?: CostingDoc
  variant: VariantDoc
}

export function ProductCostingLinks() {
  const { id } = useDocumentInfo()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      const variantsRes = await fetch(
        `/api/variants?where[product][equals]=${id}&depth=0&limit=100`,
        { credentials: 'include' },
      )
      const variantsJson = (await variantsRes.json()) as { docs: VariantDoc[] }

      const nextRows = await Promise.all(
        variantsJson.docs.map(async (variant): Promise<Row> => {
          const costingsRes = await fetch(
            `/api/costings?where[variant][equals]=${variant.id}&depth=0&limit=1`,
            { credentials: 'include' },
          )
          const costingsJson = (await costingsRes.json()) as { docs: CostingDoc[] }
          return { variant, costing: costingsJson.docs[0] }
        }),
      )

      if (!cancelled) setRows(nextRows)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return null
  if (rows === null) return <div style={{ fontSize: 13, opacity: 0.75 }}>იტვირთება…</div>
  if (rows.length === 0) return <div style={{ fontSize: 13, opacity: 0.75 }}>ვარიანტი არ არსებობს</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(({ variant, costing }) => (
        <div key={variant.id} style={{ fontSize: 13 }}>
          <div>{variant.title ?? `ვარიანტი #${variant.id}`}</div>
          {costing ? (
            <>
              <div style={{ opacity: 0.85 }}>
                {costing.indicator ? INDICATOR_EMOJI[costing.indicator] : '—'}{' '}
                შემოთავაზებული {costing.suggestedPriceGel ?? '—'} ₾ ↔ მიმდინარე {variant.price ?? '—'} ₾
              </div>
              <a href={`/admin/collections/costings/${costing.id}`}>ფასის კალკულაცია →</a>
            </>
          ) : (
            <div style={{ opacity: 0.75 }}>კალკულაცია არ არსებობს</div>
          )}
        </div>
      ))}
    </div>
  )
}
