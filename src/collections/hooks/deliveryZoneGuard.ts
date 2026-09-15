import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook } from 'payload'

import { ka } from '../../i18n/ka'

// ADR 0015 §1: the default zone (0 ₾, sortOrder 0) can never be deleted or
// turned off — every other page (cart, checkout, product delivery line)
// assumes it always exists and is active.
export const TBILISI_SLUG = 'tbilisi'

export const guardTbilisiUpdate: CollectionBeforeChangeHook = async ({ data, operation, originalDoc }) => {
  if (operation !== 'update' || !data || originalDoc?.slug !== TBILISI_SLUG) return data

  if (data.active === false) {
    throw new APIError(ka.server.deliveryZones.tbilisiCannotDeactivate, 400)
  }
  if (typeof data.slug === 'string' && data.slug !== TBILISI_SLUG) {
    throw new APIError(ka.server.deliveryZones.tbilisiSlugImmutable, 400)
  }
  return data
}

export const guardTbilisiDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const existing = await req.payload.findByID({
    collection: 'delivery-zones',
    id,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.slug === TBILISI_SLUG) {
    throw new APIError(ka.server.deliveryZones.tbilisiCannotDelete, 400)
  }
}
