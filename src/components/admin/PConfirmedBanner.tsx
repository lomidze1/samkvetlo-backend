import { Banner } from '@payloadcms/ui'
import type { Payload } from 'payload'

// ADR 0006, T1.4: admin-wide warning, visible only while
// pricing-settings.pConfirmed = false. Server component (beforeDashboard) —
// reads the admin-only global directly via Local API; never reaches the site.
export async function PConfirmedBanner({ payload }: { payload: Payload }) {
  const settings = await payload.findGlobal({ slug: 'pricing-settings', overrideAccess: true })

  if (settings.pConfirmed) return null

  return (
    <Banner to="/admin/globals/pricing-settings" type="warning">
      P% დაუდასტურებელია — ავტომატური ფასის რეჟიმი დაბლოკილია, სანამ მფლობელი pricing-settings-ში არ დაადასტურებს.
    </Banner>
  )
}
