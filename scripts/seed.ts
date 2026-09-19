// ADR 0005 T1.10: dev/test catalog + delivery zones. Idempotent (re-running
// never duplicates a category/product/portfolio item/delivery zone).
// `SEED_SENTINEL=1` additionally writes tests/fixtures/sentinel.ts's unique
// values into every hidden field, so the secrecy test (tests/int/secrecy.
// int.spec.ts) can prove none of it ever reaches a public DTO/endpoint.
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import { recomputeProductPricing } from '../src/collections/hooks/variantPricing'
import { slugify } from '../src/lib/translit'
import { SENTINEL } from '../tests/fixtures/sentinel'
import { buildOtpauthUri, generateTotpSecret } from '../src/server/security/totp'

// Dev-only placeholders — never real numbers. The owner replaces these in
// the admin (site-settings.phone/phoneSecondary, X2); seeding only needs
// non-empty values so the header utility bar, call button and contact
// section have something to render.
const SEED_PLACEHOLDER_PHONE = '+995 555 00 00 00'
const SEED_PLACEHOLDER_PHONE_SECONDARY = '+995 555 00 00 01'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(dirname, '../tests/fixtures')

// afterChange/afterDelete revalidate hooks (T1.11) must stay silent while
// seeding — there's no frontend to notify yet in CI, and a real dev run
// would otherwise fire dozens of webhook POSTs for one `pnpm seed`.
const SEED_CONTEXT = { disableRevalidate: true }

// Named once, reused by both runSeed and teardownSeed (the latter is for
// int tests that call runSeed against the shared samkvetlo_test DB and must
// not leave a permanent catalog behind for unrelated tests — e.g.
// ratesRecompute.int.spec.ts's recomputeCostingsForNewRate walks *every*
// costing in the DB, so a leftover seeded costing changes its counts).
const CATEGORY_NAMES = ['ზარები', 'საეკლესიო ზარები', 'შანდლები', 'ჭურჭელი'] as const
const PRODUCT_TITLES = ['საეკლესიო ზარი „მთავარანგელოზი“', 'შანდალი „კეთილი“', 'ბარძიმი „წმინდა“'] as const
const PORTFOLIO_CHURCH = 'წმინდა გიორგის საკათედრო ტაძარი'
const SEED_SUPPLIER_NAME = 'სამკვეთლოს მიმწოდებელი'

// ---------------------------------------------------------------------------
// Placeholder images (ADR: real-size, gray + "PLACEHOLDER" text, never an AI
// photo) — generated on the fly with sharp from an inline SVG, ≥ 2000px.
// ---------------------------------------------------------------------------
let placeholderImageCache: Buffer | null = null
async function placeholderImage(): Promise<Buffer> {
  if (placeholderImageCache) return placeholderImageCache
  const size = 2200
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="#9a9a9a"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="140" fill="#f2f2f2"
      text-anchor="middle" dominant-baseline="middle">PLACEHOLDER</text>
  </svg>`
  placeholderImageCache = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer()
  return placeholderImageCache
}

async function createPlaceholderMedia(payload: Payload, alt: string): Promise<number> {
  const data = await placeholderImage()
  const doc = await payload.create({
    collection: 'media',
    data: { alt },
    file: { data, mimetype: 'image/jpeg', name: 'placeholder.jpg', size: data.length },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
  return doc.id
}

// ---------------------------------------------------------------------------
// Small idempotent upsert helpers
// ---------------------------------------------------------------------------
// ADR 0018 §4 (T5.17): the seeded dev admin also needs a TOTP secret, or
// every seed-driven local login is fail-closed (requireTotp.ts). Reuses
// SEED_ADMIN_TOTP_SECRET if set (a stable value for repeatable local/CI
// runs), otherwise generates and prints a fresh one — same shape as
// scripts/admin-totp.ts's own enrollment.
async function ensureAdminTotp(payload: Payload, email: string, userId: number | string): Promise<void> {
  const secret = process.env.SEED_ADMIN_TOTP_SECRET || generateTotpSecret()
  await payload.update({
    collection: 'users',
    id: userId,
    data: { totpSecret: secret, totpLastStep: null, totpEnabledAt: new Date().toISOString() },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
  if (!process.env.SEED_ADMIN_TOTP_SECRET) {
    console.log(`seed: generated a TOTP secret for ${email} (add SEED_ADMIN_TOTP_SECRET to .env to keep it stable):`)
    console.log(`  URI:    ${buildOtpauthUri(secret, email)}`)
    console.log(`  Secret: ${secret}`)
  }
}

async function ensureAdmin(payload: Payload): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!email || !password) {
    console.warn('seed: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — skipping admin user')
    return
  }
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) {
    if (!docs[0].totpSecret) await ensureAdminTotp(payload, email, docs[0].id)
    return
  }
  const user = await payload.create({ collection: 'users', data: { email, password }, overrideAccess: true })
  await ensureAdminTotp(payload, email, user.id)
}

/**
 * The header utility bar, mobile call button and home contact section all
 * render `null` while `site-settings.phone` is empty — which it is by
 * default, since nothing seeded it. A fake, obviously-placeholder number
 * lets those sections render in dev; the owner sets the real one in the
 * admin before launch (never overwritten here once set).
 */
async function ensureSiteSettingsPhone(payload: Payload): Promise<void> {
  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  if (settings.phone) return
  await payload.updateGlobal({
    slug: 'site-settings',
    data: { phone: SEED_PLACEHOLDER_PHONE, phoneSecondary: SEED_PLACEHOLDER_PHONE_SECONDARY },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
}

// T3.4 (ADR 0007 §5): order.created notifications go nowhere without at
// least one owner recipient. Dev-only placeholders — never real
// contacts — so a fresh dev DB actually exercises the email/SMS adapters;
// the owner replaces these in the admin before launch (never overwritten
// here once set, same as ensureSiteSettingsPhone above). ⏳ owner question:
// the real owner email(s)/phone(s) to use in production.
const SEED_PLACEHOLDER_OWNER_EMAIL = 'owner@samkvetlo.local'
const SEED_PLACEHOLDER_OWNER_PHONE = '+995500000000'

async function ensureSiteSettingsOwnerContacts(payload: Payload): Promise<void> {
  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  if ((settings.ownerEmails?.length ?? 0) > 0 || (settings.ownerPhones?.length ?? 0) > 0) return
  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      ownerEmails: [{ email: SEED_PLACEHOLDER_OWNER_EMAIL }],
      ownerPhones: [{ phone: SEED_PLACEHOLDER_OWNER_PHONE }],
    },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
}

interface StaticPageSeed {
  slug: 'how-we-work' | 'about' | 'delivery' | 'contact' | 'privacy'
  title: string
  text: string | string[]
}

// ADR 0014 §12 (D25, T5.12): the privacy page's 6 mandatory points — placeholder
// copy (⚖️ lawyer review still pending), but with the real retention rule
// (2 years) and mechanism, not "text coming soon". One paragraph per point.
const PRIVACY_PAGE_PARAGRAPHS: string[] = [
  '1. რას ვაგროვებთ: სახელი, გვარი, ტელეფონი, ეკლესია/სამრევლო, მიწოდების ზონა და ქალაქი, ელფოსტა და კომენტარი (არჩევითი), ინდ. მოთხოვნის შემთხვევაში — თანდართული ფაილები. IP მისამართს ვინახავთ მხოლოდ დაჰეშილი სახით, 30 დღე.',
  '2. რატომ ვაგროვებთ: შეკვეთის დადასტურება და თქვენთან დაკავშირება, მიწოდების ორგანიზება, ბუღალტრული აღრიცხვა. მარკეტინგისთვის ამ მონაცემებს არ ვიყენებთ.',
  '3. რამდენ ხანს ვინახავთ: 2 წელი შეკვეთის ან მოთხოვნის ბოლო სტატუსის ცვლილებიდან (მაგალითად, მიწოდებიდან). ამის შემდეგ საკონტაქტო მონაცემები ავტომატურად ანონიმდება. ბუღალტრული ჩანაწერი (ნომერი, ნივთები, თანხა, თარიღები) საკონტაქტო მონაცემების გარეშე რჩება კანონით დადგენილი ვადით. გაზიარების ბმული აქტიურია 90 დღე, სარეზერვო ასლები — 35 დღე.',
  '4. ვინ ამუშავებს მონაცემებს: სერვერი (Vercel), მონაცემთა ბაზა (Neon), ფაილების საცავი (Cloudflare), შეცდომების მონიტორინგი (Sentry) და ელფოსტა/SMS-ის პროვაიდერი.',
  '5. თქვენი უფლებები: მონაცემების ნახვა, შესწორება ან ვადამდე წაშლა შეგიძლიათ მოითხოვოთ ტელეფონით ან ელფოსტით.',
  '6. საკონტაქტო ინფორმაცია მოცემულია საიტის სათაურში/footer-ში.',
]

// T2.7 needs `pages` content to render at all; without this every static
// route 404s in a fresh dev DB. Real copy (and the lawyer-reviewed privacy
// text, T5.12) is the owner's/designer's job — this is just enough that the
// page isn't empty. Idempotent: never overwrites existing (owner-edited) content.
const STATIC_PAGES: StaticPageSeed[] = [
  { slug: 'how-we-work', title: 'როგორ ვმუშაობთ', text: 'მარტივად და გამჭვირვალედ: შეკვეთიდან მიწოდებამდე. სრული ტექსტი მალე დაემატება.' },
  { slug: 'about', title: 'ჩვენ შესახებ', text: 'სამკვეთლო აკეთებს დიდ ზარებს და საეკლესიო ინვენტარს შეკვეთით. სრული ტექსტი მალე დაემატება.' },
  { slug: 'delivery', title: 'მიწოდება', text: 'თბილისში მიწოდება უფასოა. სხვა ქალაქებში — ზონის მიხედვით. დეტალები ცხრილშია.' },
  { slug: 'contact', title: 'კონტაქტი', text: 'დაგვირეკეთ ან მოგვწერეთ — სრული საკონტაქტო ინფორმაცია მალე დაემატება.' },
  { slug: 'privacy', title: 'კონფიდენციალურობა', text: PRIVACY_PAGE_PARAGRAPHS },
]

function richTextFrom(text: string | string[]) {
  const paragraphs = Array.isArray(text) ? text : [text]
  return {
    root: {
      type: 'root' as const,
      direction: null,
      format: '' as const,
      indent: 0,
      version: 1 as const,
      children: paragraphs.map((paragraph) => ({
        type: 'paragraph' as const,
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1 as const,
        children: [
          { type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: paragraph, version: 1 as const },
        ],
      })),
    },
  }
}

async function ensureStaticPages(payload: Payload): Promise<void> {
  for (const page of STATIC_PAGES) {
    const { docs } = await payload.find({
      collection: 'pages',
      where: { slug: { equals: page.slug } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) continue
    await payload.create({
      collection: 'pages',
      data: { slug: page.slug, title: page.title, content: richTextFrom(page.text) },
      overrideAccess: true,
      context: SEED_CONTEXT,
    })
  }
}

async function upsertCategory(payload: Payload, name: string, parentId?: number): Promise<number> {
  const slug = slugify(name)
  const { docs } = await payload.find({
    collection: 'categories',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) return docs[0].id
  const doc = await payload.create({
    collection: 'categories',
    data: { name, parent: parentId },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
  return doc.id
}

async function ensureExchangeRate(payload: Payload): Promise<void> {
  const { docs } = await payload.find({ collection: 'exchange-rates', limit: 1, overrideAccess: true })
  if (docs[0]) return
  await payload.create({
    collection: 'exchange-rates',
    data: {
      // Fixed and deliberately early (not "now"): computeCostingFields only
      // needs *some* baseline rate to exist, and other int tests
      // (costings/ratesRecompute) create their own dated 2026 rates and
      // rely on being the most recent by date — a "now" seed rate would
      // otherwise race ahead of them once it's September 2026.
      date: '2025-06-01T00:00:00.000Z',
      rubGel: 0.0305,
      usdGel: 2.66,
      source: 'seed',
      fetchedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })
}

async function upsertSupplier(payload: Payload, sentinelMode: boolean): Promise<number> {
  const name = sentinelMode ? SENTINEL.supplierName : 'სამკვეთლოს მიმწოდებელი'
  const { docs } = await payload.find({
    collection: 'suppliers',
    where: { name: { equals: name } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) return docs[0].id
  const doc = await payload.create({
    collection: 'suppliers',
    data: { name, photosAllowed: false },
    overrideAccess: true,
  })
  return doc.id
}

async function loadPdf(): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, 'sample.pdf'))
}

const EMPTY_RICH_TEXT = (text: string) => ({
  root: {
    type: 'root' as const,
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1 as const,
    children: [
      {
        type: 'paragraph' as const,
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1 as const,
        children: [
          { type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text, version: 1 as const },
        ],
      },
    ],
  },
})

interface VariantSeed {
  title: string
  coating: 'gilding' | 'silvering' | 'gold-leaf' | 'enamel' | 'none'
  size?: string
  weightKg?: number
  diameterMm?: number
  heightMm?: number
  leadTimeText?: string
  costRub: number
  logisticsGel: number
}

interface ProductDocumentInput {
  title: string
  kind: 'certificate' | 'passport' | 'other'
  file: number
  issuer?: string
  reviewedNoSecretInfo: boolean
}

interface ProductSeed {
  title: string
  categoryId: number
  tier: 'flagship' | 'standard'
  featured?: boolean
  galleryCount: number
  withDocument?: boolean
  variants: VariantSeed[]
}

async function approveVariant(payload: Payload, variantId: number, costingId: number, price: number): Promise<void> {
  const now = new Date().toISOString()
  await payload.update({
    collection: 'variants',
    id: variantId,
    data: { price, priceStatus: 'approved' },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
  await payload.update({
    collection: 'costings',
    id: costingId,
    data: { proposedPriceGel: price, approvedAt: now },
    overrideAccess: true,
  })
}

async function seedProduct(
  payload: Payload,
  seed: ProductSeed,
  supplierId: number,
  sentinelMode: boolean,
): Promise<void> {
  const slug = slugify(seed.title)
  const { docs: existing } = await payload.find({
    collection: 'products',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing[0]) {
    // Already fully seeded — but still self-heal minPrice/isPurchasable in
    // case an earlier run was interrupted between approving a variant and
    // the recompute (a prior run of this dev DB left `bardzimi-tsminda`
    // with isPurchasable=false despite its variant having an approved
    // price — root cause of the "ჭურჭელი 0 ნივთი" bug: stale denormalized
    // columns, not the catalog count query or cache).
    await recomputeProductPricing(payload, existing[0].id)
    return
  }

  const galleryIds: number[] = []
  for (let i = 0; i < seed.galleryCount; i += 1) {
    galleryIds.push(await createPlaceholderMedia(payload, `${seed.title} — ფოტო ${i + 1} (placeholder)`))
  }

  let documents: ProductDocumentInput[] | undefined
  if (seed.withDocument) {
    const pdf = await loadPdf()
    const publicFile = await payload.create({
      collection: 'public-files',
      data: {},
      file: { data: pdf, mimetype: 'application/pdf', name: 'certificate.pdf', size: pdf.length },
      overrideAccess: true,
      context: SEED_CONTEXT,
    })
    documents = [
      {
        title: 'ხარისხის სერტიფიკატი',
        kind: 'certificate',
        file: publicFile.id,
        // D19 (ADR 0005/0009): a document's issuer is a public field, but a
        // *real* supplier name still never belongs in our own dev seed data
        // (only the sentinel fixture deliberately puts one there, to prove
        // the exception works) — a generic certifying-body label exercises
        // the same field/UI without naming our actual supplier.
        issuer: sentinelMode ? SENTINEL.supplierName : 'ხარისხის სასერტიფიკაციო ორგანო',
        reviewedNoSecretInfo: true,
      },
    ]
  }

  const product = await payload.create({
    collection: 'products',
    data: {
      title: seed.title,
      category: seed.categoryId,
      tier: seed.tier,
      featured: seed.featured ?? false,
      description: EMPTY_RICH_TEXT(`${seed.title} — ხელნაკეთი, საეკლესიო გამოყენებისთვის. სრული აღწერა მალე დაემატება.`),
      whyQuality: seed.tier === 'flagship' ? EMPTY_RICH_TEXT('ხელნაკეთი, საუკეთესო მასალით და ხანგრძლივი გამოცდილებით.') : undefined,
      gallery: galleryIds,
      documents,
      _status: 'published',
    },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })

  // The product's own afterChange hook (createDefaultVariant) just made one
  // default variant ("სტანდარტული") — reuse it as the first seed variant
  // instead of creating a duplicate.
  const { docs: defaultVariants } = await payload.find({
    collection: 'variants',
    where: { product: { equals: product.id } },
    limit: 1,
    overrideAccess: true,
  })
  const defaultVariantId = defaultVariants[0]!.id

  for (const [index, variantSeed] of seed.variants.entries()) {
    const variantId =
      index === 0
        ? await payload
            .update({
              collection: 'variants',
              id: defaultVariantId,
              data: {
                title: variantSeed.title,
                coating: variantSeed.coating,
                size: variantSeed.size,
                weightKg: variantSeed.weightKg,
                diameterMm: variantSeed.diameterMm,
                heightMm: variantSeed.heightMm,
                leadTimeText: variantSeed.leadTimeText,
                sortOrder: index,
              },
              overrideAccess: true,
              context: SEED_CONTEXT,
            })
            .then((doc) => doc.id)
        : await payload
            .create({
              collection: 'variants',
              data: {
                product: product.id,
                title: variantSeed.title,
                coating: variantSeed.coating,
                size: variantSeed.size,
                weightKg: variantSeed.weightKg,
                diameterMm: variantSeed.diameterMm,
                heightMm: variantSeed.heightMm,
                leadTimeText: variantSeed.leadTimeText,
                sortOrder: index,
                availability: 'ready',
              },
              overrideAccess: true,
              context: SEED_CONTEXT,
            })
            .then((doc) => doc.id)

    const costing = await payload.create({
      collection: 'costings',
      data: {
        variant: variantId,
        supplier: supplierId,
        supplierUrl: sentinelMode ? SENTINEL.supplierUrl : 'https://supplier.invalid/catalog',
        supplierSku: sentinelMode ? SENTINEL.supplierSku : `SUP-${variantId}`,
        costRub: sentinelMode ? SENTINEL.costRub : variantSeed.costRub,
        logisticsGel: variantSeed.logisticsGel,
        notes: sentinelMode ? SENTINEL.note : undefined,
      },
      overrideAccess: true,
    })

    await approveVariant(payload, variantId, costing.id, costing.suggestedPriceGel!)
  }

  // Belt and suspenders: the variant hooks above already recompute this, but
  // a script that awaits sequentially (unlike a concurrent admin edit) has
  // no reason not to double-check the final state is consistent.
  await recomputeProductPricing(payload, product.id)
}

async function seedPortfolio(payload: Payload, productId: number): Promise<void> {
  const church = 'წმინდა გიორგის საკათედრო ტაძარი'
  const slug = slugify(church)
  const { docs } = await payload.find({
    collection: 'portfolio',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) return

  const photoId = await createPlaceholderMedia(payload, 'ნამუშევრის ფოტო (placeholder)')
  await payload.create({
    collection: 'portfolio',
    data: {
      church,
      city: 'თბილისი',
      photos: [photoId],
      products: [productId],
      consent: true,
      _status: 'published',
    },
    overrideAccess: true,
    context: SEED_CONTEXT,
  })
}

interface ZoneSeed {
  name: string
  feeGel: number
  sortOrder: number
  examples?: string
  // Only the default zone needs this: `guardTbilisiUpdate`/`guardTbilisiDelete`
  // (deliveryZoneGuard.ts) match on the literal slug `tbilisi`, which no
  // longer falls out of `slugify(name)` now that the name is "თბილისი და
  // 150 კმ-მდე". Every other zone keeps the auto-derived slug.
  slug?: string
}

// ADR 0015, owner decision 2026-09-18: distance from Tbilisi, not region —
// up to 150 km is free, 150–250 km is +150 ₾, beyond that +250 ₾.
const DELIVERY_ZONES: ZoneSeed[] = [
  { name: 'თბილისი და 150 კმ-მდე', slug: 'tbilisi', feeGel: 0, sortOrder: 0, examples: 'რუსთავი, მცხეთა, გორი, თელავი' },
  {
    name: '150–250 კმ',
    feeGel: 150,
    sortOrder: 10,
    examples: 'ქუთაისი, ზესტაფონი, ახალციხე, ბორჯომი, ლაგოდეხი, სტეფანწმინდა',
  },
  { name: '250 კმ-ზე მეტი', feeGel: 250, sortOrder: 20, examples: 'ბათუმი, ზუგდიდი, ფოთი, ოზურგეთი, მესტია' },
]

async function seedDeliveryZones(payload: Payload): Promise<void> {
  for (const zone of DELIVERY_ZONES) {
    const slug = zone.slug ?? slugify(zone.name)
    const { docs } = await payload.find({
      collection: 'delivery-zones',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) continue
    await payload.create({
      collection: 'delivery-zones',
      data: { name: zone.name, slug, examples: zone.examples, feeGel: zone.feeGel, sortOrder: zone.sortOrder },
      overrideAccess: true,
      context: SEED_CONTEXT,
    })
  }
}

export async function runSeed(payload: Payload): Promise<void> {
  const sentinelMode = process.env.SEED_SENTINEL === '1'

  await ensureAdmin(payload)
  await ensureSiteSettingsPhone(payload)
  await ensureSiteSettingsOwnerContacts(payload)
  await ensureStaticPages(payload)

  const bellsId = await upsertCategory(payload, 'ზარები')
  const churchBellsId = await upsertCategory(payload, 'საეკლესიო ზარები', bellsId)
  const candlesticksId = await upsertCategory(payload, 'შანდლები')
  const vesselsId = await upsertCategory(payload, 'ჭურჭელი')

  await ensureExchangeRate(payload)
  const supplierId = await upsertSupplier(payload, sentinelMode)

  await seedProduct(
    payload,
    {
      title: 'საეკლესიო ზარი „მთავარანგელოზი“',
      categoryId: churchBellsId,
      tier: 'flagship',
      featured: true,
      galleryCount: 4,
      withDocument: true,
      variants: [
        {
          title: 'მოოქროვილი · 50 კგ',
          coating: 'gilding',
          weightKg: 50,
          diameterMm: 420,
          heightMm: 480,
          leadTimeText: '30–45 დღე',
          costRub: 800_000,
          logisticsGel: 300,
        },
        {
          title: 'დაფარვის გარეშე · 50 კგ',
          coating: 'none',
          weightKg: 50,
          diameterMm: 420,
          heightMm: 480,
          leadTimeText: '30–45 დღე',
          costRub: 650_000,
          logisticsGel: 300,
        },
      ],
    },
    supplierId,
    sentinelMode,
  )

  await seedProduct(
    payload,
    {
      title: 'შანდალი „კეთილი“',
      categoryId: candlesticksId,
      tier: 'flagship',
      featured: false,
      galleryCount: 4,
      variants: [
        {
          title: 'მოვერცხლილი',
          coating: 'silvering',
          size: 'H 1200 მმ',
          leadTimeText: '14–21 დღე',
          costRub: 300_000,
          logisticsGel: 150,
        },
      ],
    },
    supplierId,
    sentinelMode,
  )

  await seedProduct(
    payload,
    {
      title: 'ბარძიმი „წმინდა“',
      categoryId: vesselsId,
      tier: 'standard',
      galleryCount: 1,
      variants: [
        {
          title: 'სტანდარტული',
          coating: 'none',
          leadTimeText: '7–14 დღე',
          costRub: 150_000,
          logisticsGel: 80,
        },
      ],
    },
    supplierId,
    sentinelMode,
  )

  const { docs: bellDocs } = await payload.find({
    collection: 'products',
    where: { slug: { equals: slugify('საეკლესიო ზარი „მთავარანგელოზი“') } },
    limit: 1,
    overrideAccess: true,
  })
  if (bellDocs[0]) await seedPortfolio(payload, bellDocs[0].id)

  await seedDeliveryZones(payload)
}

/**
 * Reverses runSeed — for int tests only (see the comment on CATEGORY_NAMES
 * above). Never used by `pnpm seed` itself. Best-effort: `tbilisi` can't be
 * deleted (ADR 0015 guard) and is left in place, same as every other test
 * file already tolerates.
 */
export async function teardownSeed(payload: Payload): Promise<void> {
  for (const title of PRODUCT_TITLES) {
    const { docs } = await payload.find({
      collection: 'products',
      where: { slug: { equals: slugify(title) } },
      limit: 1,
      overrideAccess: true,
    })
    const product = docs[0]
    if (!product) continue
    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
      limit: 0,
      overrideAccess: true,
    })
    for (const variant of variants) {
      await payload
        .delete({ collection: 'costings', where: { variant: { equals: variant.id } }, overrideAccess: true })
        .catch(() => undefined)
    }
    await payload.delete({ collection: 'variants', where: { product: { equals: product.id } }, overrideAccess: true })
    await payload.delete({ collection: 'products', id: product.id, overrideAccess: true })
  }

  const { docs: portfolioDocs } = await payload.find({
    collection: 'portfolio',
    where: { slug: { equals: slugify(PORTFOLIO_CHURCH) } },
    limit: 1,
    overrideAccess: true,
  })
  if (portfolioDocs[0]) await payload.delete({ collection: 'portfolio', id: portfolioDocs[0].id, overrideAccess: true })

  for (const name of [...CATEGORY_NAMES].reverse()) {
    const { docs } = await payload.find({
      collection: 'categories',
      where: { slug: { equals: slugify(name) } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) await payload.delete({ collection: 'categories', id: docs[0].id, overrideAccess: true }).catch(() => undefined)
  }

  const { docs: supplierDocs } = await payload.find({
    collection: 'suppliers',
    where: { name: { in: [SEED_SUPPLIER_NAME, SENTINEL.supplierName] } },
    overrideAccess: true,
  })
  for (const supplier of supplierDocs) {
    await payload.delete({ collection: 'suppliers', id: supplier.id, overrideAccess: true }).catch(() => undefined)
  }

  await payload
    .delete({ collection: 'exchange-rates', where: { source: { equals: 'seed' } }, overrideAccess: true })
    .catch(() => undefined)

  for (const zone of DELIVERY_ZONES) {
    const slug = zone.slug ?? slugify(zone.name)
    if (slug === 'tbilisi') continue // guardTbilisiDelete forbids it anyway (ADR 0015 §1)
    const { docs } = await payload.find({
      collection: 'delivery-zones',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true,
    })
    if (docs[0]) await payload.delete({ collection: 'delivery-zones', id: docs[0].id, overrideAccess: true }).catch(() => undefined)
  }

  // T2.7: ensureStaticPages's pages, so a later int test creating its own
  // e.g. `about` page doesn't collide with a leftover from this run's
  // unique `slug`.
  for (const page of STATIC_PAGES) {
    await payload
      .delete({ collection: 'pages', where: { slug: { equals: page.slug } }, overrideAccess: true })
      .catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  await runSeed(payload)
  console.log('seed: done')
  process.exit(0)
}

// Only run as a CLI script — tests import `runSeed` directly. Compares via
// pathToFileURL (not a raw `file://` template) because the repo path has
// non-ASCII characters (TECH-STACK.md §7 "ქართული გზა"): import.meta.url
// percent-encodes them, a plain template string does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('seed failed', error)
    process.exit(1)
  })
}
