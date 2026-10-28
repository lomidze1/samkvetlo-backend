'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Products list: the first gallery photo plus a +N count, no file names;
// clicking the photo opens a modal with every gallery photo (thumbnails on
// the right, ← → keys) instead of the product (owner request 2026-10-28).
// The list cell gets media ids, so the photos are fetched here.
type MediaDoc = {
  alt?: string | null
  id: number | string
  sizes?: Record<string, { url?: string | null } | undefined> | null
  thumbnailURL?: string | null
  url?: string | null
}

function mediaId(item: unknown): number | string | undefined {
  if (typeof item === 'number' || typeof item === 'string') return item
  if (typeof item === 'object' && item !== null && 'id' in item) return (item as { id: number | string }).id
  return undefined
}

const thumbOf = (doc: MediaDoc) => doc.thumbnailURL ?? doc.url
const largeOf = (doc: MediaDoc) => doc.sizes?.w1280?.url ?? doc.url

export function GalleryCell({ cellData }: { cellData?: unknown }) {
  const ids = (Array.isArray(cellData) ? cellData : [])
    .map(mediaId)
    .filter((id): id is number | string => id !== undefined)
  const idsKey = ids.join(',')
  const [first, setFirst] = useState<MediaDoc | null>(null)
  const [all, setAll] = useState<MediaDoc[] | null>(null)
  const [index, setIndex] = useState<number | null>(null)
  const open = index !== null

  useEffect(() => {
    if (ids.length === 0) return
    let cancelled = false
    void fetch(`/api/media/${ids[0]}?depth=0`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<MediaDoc>) : null))
      .then((json) => {
        if (!cancelled) setFirst(json)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id list
  }, [idsKey])

  // All photos load only when the modal is first opened.
  useEffect(() => {
    if (!open || all) return
    let cancelled = false
    const query = ids.map((id) => `where[id][in]=${id}`).join('&')
    void fetch(`/api/media?${query}&depth=0&limit=${ids.length}`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<{ docs: MediaDoc[] }>) : null))
      .then((json) => {
        if (cancelled || !json) return
        // `in` does not keep the gallery order; restore it.
        const byId = new Map(json.docs.map((doc) => [String(doc.id), doc]))
        setAll(ids.map((id) => byId.get(String(id))).filter((doc): doc is MediaDoc => !!doc))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id list
  }, [open, all, idsKey])

  const photos = all ?? (first ? [first] : [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIndex(null)
      if (event.key === 'ArrowRight') setIndex((i) => (i === null ? i : (i + 1) % photos.length))
      if (event.key === 'ArrowLeft') setIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, photos.length])

  if (ids.length === 0) return null
  const current = index !== null ? photos[index] : undefined
  const step = (delta: number) => setIndex((i) => (i === null ? i : (i + delta + photos.length) % photos.length))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {first && thumbOf(first) ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setIndex(0)
          }}
          style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
          <img
            src={thumbOf(first) ?? ''}
            alt={first.alt ?? ''}
            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 3 }}
          />
        </button>
      ) : (
        <div style={{ width: 48, height: 48 }} />
      )}
      {ids.length > 1 && <span style={{ opacity: 0.7 }}>+{ids.length - 1}</span>}

      {current &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setIndex(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              background: 'rgba(0, 0, 0, 0.85)',
            }}
          >
            {photos.length > 1 && <ArrowButton label="წინა" onClick={() => step(-1)} text="‹" />}
            {/* eslint-disable-next-line @next/next/no-img-element -- admin preview */}
            <img
              src={largeOf(current) ?? ''}
              alt={current.alt ?? ''}
              onClick={(event) => event.stopPropagation()}
              style={{ maxWidth: '72vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 4 }}
            />
            {photos.length > 1 && <ArrowButton label="შემდეგი" onClick={() => step(1)} text="›" />}
            {photos.length > 1 && (
              <div
                onClick={(event) => event.stopPropagation()}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '90vh', overflowY: 'auto' }}
              >
                {photos.map((photo, i) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    style={{
                      padding: 0,
                      border: i === index ? '2px solid #fff' : '2px solid transparent',
                      borderRadius: 4,
                      background: 'none',
                      cursor: 'pointer',
                      opacity: i === index ? 1 : 0.6,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
                    <img
                      src={thumbOf(photo) ?? ''}
                      alt={photo.alt ?? ''}
                      style={{ display: 'block', width: 64, height: 64, objectFit: 'cover', borderRadius: 2 }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

function ArrowButton({ label, onClick, text }: { label: string; onClick: () => void; text: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      style={{
        width: 44,
        height: 44,
        border: 0,
        borderRadius: '50%',
        background: 'rgba(255, 255, 255, 0.15)',
        color: '#fff',
        fontSize: 28,
        lineHeight: 1,
        cursor: 'pointer',
      }}
    >
      {text}
    </button>
  )
}
