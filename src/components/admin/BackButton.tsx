'use client'

import { useRouter } from 'next/navigation'

// Header action: one step back in the admin (owner request 2026-10-28).
// Falls back to the dashboard when the admin was opened in a fresh tab.
export function BackButton() {
  const router = useRouter()

  return (
    <button
      type="button"
      className="admin-back-button"
      aria-label="უკან"
      title="უკან"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/admin'))}
    >
      ←
    </button>
  )
}
