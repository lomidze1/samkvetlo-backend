import { ValidationError, type CollectionBeforeValidateHook } from 'payload'

/**
 * ADR 0006 §"დადასტურება" step 3: autoPricing can only be turned on once
 * the owner has confirmed P% (pricing-settings.pConfirmed).
 */
export const validateAutoPricing: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data || data.autoPricing !== true) return data

  const settings = await req.payload.findGlobal({ slug: 'pricing-settings', req })
  if (!settings.pConfirmed) {
    throw new ValidationError({
      errors: [
        {
          path: 'autoPricing',
          message: 'P% დაუდასტურებელია — ავტომატური ფასი ვერ ჩაირთვება',
        },
      ],
    })
  }

  return data
}
