import { ValidationError, type CollectionBeforeValidateHook } from 'payload'

/**
 * Consent is the whole reason a church/customer's photos may appear on the
 * site at all — a draft can be missing it while it's being put together,
 * but publishing without it is blocked (mirrors validateProductPublish).
 */
export const validatePortfolioPublish: CollectionBeforeValidateHook = ({ data }) => {
  if (!data || data._status !== 'published') return data

  if (data.consent !== true) {
    throw new ValidationError({
      errors: [{ path: 'consent', message: 'გამოქვეყნებამდე საჭიროა თანხმობის დადასტურება (✔)' }],
    })
  }

  return data
}
