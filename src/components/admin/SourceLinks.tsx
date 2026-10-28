'use client'

import { useEffect, useState } from 'react'

// Admin-only "წყარო ↗" links to the supplier's product page (owner request
// 2026-10-28). supplierUrl lives on costings, which only admins can read
// (ADR 0005), so nothing here reaches the public site.

function SourceLink({ url }: { url: string }) {
  // Only http(s): a costing's supplierUrl is free text.
  if (!/^https?:\/\//i.test(url)) return <span>{url}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(event) => event.stopPropagation()}
    >
      წყარო ↗
    </a>
  )
}

/** Costings list: the supplierUrl cell as a link instead of plain text. */
export function SupplierUrlCell({ cellData }: { cellData?: unknown }) {
  if (typeof cellData !== 'string' || cellData === '') return null
  return <SourceLink url={cellData} />
}

/** Products list: the supplier URL(s) of the product's variants' costings. */
export function ProductSourceCell({ rowData }: { rowData?: { id?: number | string } }) {
  const id = rowData?.id
  const [urls, setUrls] = useState<string[] | null>(null)

  useEffect(() => {
    if (id === undefined) return
    let cancelled = false

    async function load() {
      const res = await fetch(
        `/api/costings?where[variant.product][equals]=${id}&depth=0&limit=100&select[supplierUrl]=true`,
        { credentials: 'include' },
      )
      const json = (await res.json()) as { docs?: { supplierUrl?: string | null }[] }
      const unique = [...new Set((json.docs ?? []).map((doc) => doc.supplierUrl).filter((url): url is string => !!url))]
      if (!cancelled) setUrls(unique)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!urls || urls.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {urls.map((url) => (
        <SourceLink key={url} url={url} />
      ))}
    </div>
  )
}
