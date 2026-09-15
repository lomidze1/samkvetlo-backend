// Server-side Georgian text (email/SMS templates, admin-only strings).
// User-facing storefront text lives in samkvetlo/src/i18n/ka.ts (ADR 0004, 0012).
export const ka = {
  server: {
    pricing: {
      priceRequired: 'price სავალდებულოა და დადებითი რიცხვი უნდა იყოს',
      redNeedsOverride: 'ინდიკატორი 🔴-ია — დადასტურებისთვის საჭიროა overrideRed და მიზეზი',
      redNeedsReason: '🔴 override-ისთვის მიზეზი სავალდებულოა',
      needsReviewSubject: 'ფასების გადასინჯვაა საჭირო — კურსი შეიცვალა',
      needsReviewLine: (sku: string, oldPrice: number, newPrice: number) =>
        `${sku}: ${oldPrice} ₾ → ${newPrice} ₾ (შემოთავაზებული)`,
    },
    deliveryZones: {
      // ADR 0015 §1: the default zone can never be turned off, renamed
      // (its slug), or deleted.
      tbilisiCannotDeactivate: '„თბილისი“ ვერ გამოირთვება',
      tbilisiSlugImmutable: '„თბილისი“-ის slug ვერ შეიცვლება',
      tbilisiCannotDelete: '„თბილისი“ ვერ წაიშლება',
    },
  },
} as const
