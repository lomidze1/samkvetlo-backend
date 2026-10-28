// Server-side Georgian text (email/SMS templates, admin-only strings).
// User-facing storefront text lives in samkvetlo/src/i18n/ka.ts (ADR 0004, 0012).
export const ka = {
  server: {
    // ADR 0011 §3: shared by the CustomRequests collection's select options
    // (admin UI) and the customRequestCreated notify template (owner
    // email) — one Georgian label per category, defined once.
    customRequestCategoryLabels: {
      iconostasis: 'კანკელი',
      vestments: 'შესამოსელი',
      vessels: 'ჭურჭელი',
      icon: 'ხატი',
      other: 'სხვა',
    },
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
    // T3.4 (ADR 0007 §4/§6): order.created templates. Every value here is
    // plain Georgian text or a function producing it — templates/
    // orderCreated.ts only calls these, it never writes Georgian itself
    // (check:ka scans src/server/**).
    notify: {
      // ADR 0019 §4: default EMAIL_FROM_NAME when the env var is unset.
      emailFromName: 'სამკვეთლო',
      orderCreated: {
        ownerEmailSubject: (number: string) => `ახალი შეკვეთა ${number}`,
        ownerEmailLine: (productTitle: string, variantTitle: string, qty: number, unitPriceText: string, lineTotalText: string) =>
          `${productTitle} · ${variantTitle} · ${qty} × ${unitPriceText} = ${lineTotalText}`,
        ownerEmailDeliveryLine: (zoneName: string, feeText: string) => `მიწოდება: ${zoneName} · ${feeText}`,
        ownerEmailTotalLine: (totalText: string) => `ჯამი: ${totalText}`,
        ownerEmailAdminLink: (url: string) => `ადმინი: ${url}`,
        // ADR 0007 §4 format: "ახალი შეკვეთა SMK-2026-000123 · 7 610 ₾ · გიორგი ლ. · 599 123 456"
        ownerSms: (number: string, totalText: string, name: string, surnameInitial: string, phoneGrouped: string) =>
          `ახალი შეკვეთა ${number} · ${totalText} · ${name} ${surnameInitial}. · ${phoneGrouped}`,
        // D17, ADR 0007 §4: sent to the customer only when notifyCustomer is true — <= 140 chars.
        customerText: (number: string) => `შეკვეთა ${number} მიღებულია. მადლობა! დაგიკავშირდებით 1 სამუშაო დღეში. სამკვეთლო`,
      },
      // T3.7 (ADR 0011 §3 / ADR 0007): customRequest.created — owner email + SMS
      // only (no customer channel — the owner calls back).
      customRequestCreated: {
        ownerEmailSubject: (number: string) => `ახალი ინდ. მოთხოვნა ${number}`,
        ownerEmailCategoryLine: (categoryLabel: string) => `კატეგორია: ${categoryLabel}`,
        ownerEmailDescriptionLine: (description: string) => `აღწერა: ${description}`,
        ownerEmailContactLine: (name: string, surname: string, phoneGrouped: string) =>
          `${name} ${surname} · ${phoneGrouped}`,
        ownerEmailChurchLine: (church: string) => `ეკლესია: ${church}`,
        ownerEmailAdminLink: (url: string) => `ადმინი: ${url}`,
        // Same shape as ownerSms above: number · name initial. · phone
        ownerSms: (number: string, name: string, surnameInitial: string, phoneGrouped: string) =>
          `ახალი ინდ. მოთხოვნა ${number} · ${name} ${surnameInitial}. · ${phoneGrouped}`,
      },
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
      // ADR 0018 (T5.17): the beforeLogin gate and its custom login view.
      // One Georgian message for every rejection reason (missing code, no
      // secret, throttled, wrong/expired/replayed code) — the reason
      // itself only ever reaches the server log (requireTotp.ts), never
      // the client.
      totp: {
        invalidCode: 'კოდი არასწორია ან ვადაგასულია',
        loginEmailLabel: 'ელფოსტა',
        loginPasswordLabel: 'პაროლი',
        loginCodeLabel: 'ავთენტიფიკატორის კოდი',
        enrollmentRequired: 'დაასკანერეთ QR კოდი ავთენტიფიკატორის აპით და შეიყვანეთ 6-ციფრიანი კოდი',
      },
      roles: {
        cannotDemoteSelf: 'საკუთარ როლს ვერ შეცვლით',
      },
    },
    // ADR 0014 §12 (D25) / T5.12: the retention cron's owner digest — sent
    // only when at least one order has an open financial obligation
    // (paid/ordered-from-supplier/in-transit) past the 2-year mark, so it
    // never auto-anonymizes.
    retention: {
      openOrdersDigestSubject: (count: number) => `${count} შეკვეთა 2 წელზე მეტია ღიაა`,
      openOrdersDigestLine: (number: string, status: string) => `${number} — სტატუსი: ${status}`,
      alreadyAnonymized: 'უკვე ანონიმიზებულია',
    },
  },
} as const
