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
    // ADR 0016 (T5.14): sent to every site-settings.ownerEmails address the
    // moment a break-glass login happens, so the other partner notices
    // immediately (Users.hooks.afterLogin).
    security: {
      breakGlassSubject: (email: string) => `ადმინში შესვლა საქართველოს გარეთიდან — ${email}`,
      breakGlassBody: (email: string, country: string) =>
        `${email} შევიდა ადმინში საქართველოს გარეთ (ქვეყანა: ${country}) break-glass გამონაკლისით.\n\n` +
        'თუ ეს თქვენ ან თქვენი პარტნიორი იყავით, დამატებითი მოქმედება არ სჭირდება — გამონაკლისს ვადა თავისთავად ეწურება.\n' +
        'თუ ეს არც ერთმა თქვენგანმა არ იცის, დაუყოვნებლივ შეცვალეთ ორივე ანგარიშის პაროლი და გამორთეთ Vercel Firewall-ის break-glass წესი.',
    },
  },
} as const
