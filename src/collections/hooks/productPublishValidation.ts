import { ValidationError, type CollectionBeforeValidateHook } from 'payload'

interface DocumentRow {
  reviewedNoSecretInfo?: boolean | null
}

/**
 * ADR 0009 §4-5: only enforced when the product is being published — a
 * draft can be missing photos/copy while it's being put together.
 */
export const validateProductPublish: CollectionBeforeValidateHook = ({ data }) => {
  if (!data || data._status !== 'published') return data

  const errors: { message: string; path: string }[] = []

  if (data.tier === 'flagship') {
    if (!data.whyQuality) {
      errors.push({ path: 'whyQuality', message: '„რატომ ეს ხარისხი“ სავალდებულოა Flagship პროდუქტისთვის' })
    }
    const galleryCount = Array.isArray(data.gallery) ? data.gallery.length : 0
    if (galleryCount < 4) {
      errors.push({ path: 'gallery', message: 'Flagship პროდუქტს გალერეაში საჭიროებს მინიმუმ 4 ფოტო' })
    }
  }

  const documents = Array.isArray(data.documents) ? (data.documents as DocumentRow[]) : []
  documents.forEach((document, index) => {
    if (document.reviewedNoSecretInfo !== true) {
      errors.push({
        path: `documents.${index}.reviewedNoSecretInfo`,
        message: 'დოკუმენტის გამოქვეყნებამდე უნდა დაადასტუროთ, რომ მასზე საიდუმლო მონაცემი არ ჩანს',
      })
    }
  })

  if (errors.length > 0) {
    throw new ValidationError({ errors })
  }

  return data
}
