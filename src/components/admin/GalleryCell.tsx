'use client'

// Products list: gallery as thumbnails only, without file names (owner
// request 2026-10-28). The list loads at depth=1, so items are media docs.
type MediaDoc = { id: number | string; alt?: string | null; thumbnailURL?: string | null; url?: string | null }

const MAX_THUMBS = 3

export function GalleryCell({ cellData }: { cellData?: unknown }) {
  if (!Array.isArray(cellData) || cellData.length === 0) return null
  const docs = cellData.filter((item): item is MediaDoc => typeof item === 'object' && item !== null)
  const rest = cellData.length - Math.min(docs.length, MAX_THUMBS)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {docs.slice(0, MAX_THUMBS).map((doc) => {
        const src = doc.thumbnailURL ?? doc.url
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail
          <img
            key={doc.id}
            src={src}
            alt={doc.alt ?? ''}
            style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 3 }}
          />
        ) : null
      })}
      {rest > 0 && <span style={{ opacity: 0.7 }}>+{rest}</span>}
    </div>
  )
}
