// ADR 0005 — unique, unmistakable values seeded into every hidden field so
// a secrecy-leak test (T1.10/T2) can grep the public DTO/API output for
// `/ZZSENT|987654/` without depending on field names. Add a new entry here
// whenever a new hidden field is added to an admin-only collection or a
// private field on a public collection.
//
// D19 exception (ADR 0005 §"განახლება 2026-09-14 B" / ADR 0009 §5):
// `supplierName` is the ONE sentinel allowed to appear in a public DTO —
// written to `suppliers.name` AND to one product document's `issuer`, to
// prove the exception works. Every other sentinel below must never appear
// in any public output.
export const SENTINEL = {
  /** suppliers.name — and, via D19, one products.documents[].issuer. */
  supplierName: 'ZZSENT-NAME-7f3a',
  /** costings.supplierUrl */
  supplierUrl: 'https://zzsent-7f3a.invalid/p/1',
  /** costings.supplierSku */
  supplierSku: 'ZZSENT-SKU-7f3a',
  /** costings.notes */
  note: 'ZZSENT-NOTE-7f3a',
  /** costings.costRub */
  costRub: 987_654.32,
  /** original filename of an uploaded file, before the rename hook (ADR 0005 layer 4). */
  filename: 'zzsent-7f3a.jpg',
  /** site-settings.ownerEmails[].email (ADR 0005 layer 2, field-level access). */
  ownerEmail: 'zzsent-owner-7f3a@samkvetlo.invalid',
  /** site-settings.ownerPhones[].phone. */
  ownerPhone: '+995500987654',
  /** site-settings.shareLinkTtlDays — a number, so it borrows the 987654 grep pattern. */
  shareLinkTtlDays: 987_654,
  /** orders.name / .surname / .phone / .church / .email / .comment (PII, D25). */
  orderCustomerName: 'ZZSENT-CUSTOMER-7f3a',
  orderCustomerSurname: 'ZZSENT-SURNAME-7f3a',
  orderCustomerPhone: '+995500912345',
  orderCustomerEmail: 'zzsent-customer-7f3a@samkvetlo.invalid',
  orderCustomerChurch: 'ZZSENT-CHURCH-7f3a',
} as const
