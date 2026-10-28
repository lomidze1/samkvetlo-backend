// Catalog import: turns a package's draft JSON (_doc/catalog/packages/*.json)
// into DRAFT products in the local admin. It never publishes a product and
// never approves a price (ADR 0006: only the owner does that, in the admin).
// Supplier data goes only into `costings`/`suppliers` (ADR 0005).
//
//   pnpm tsx scripts/catalog-import.ts ../_doc/catalog/packages/svetilniki-01.json
//   pnpm tsx scripts/catalog-import.ts <file.json> --dry-run      # validate only
//
// A variant without `costing.costRub` is a „ფასი მოთხოვნით“ item (changes.md
// §13): its costing keeps the supplier link but computes no price.
//
// Idempotent: a draft whose `key` already exists as a costing.supplierSku, or
// whose title already slugifies to an existing product, is skipped. Safe to
// run while `pnpm dev` is up; several packages may be imported one after
// another (not in parallel from one process — each run opens its own Payload).
//
// JSON format: _doc/catalog/import-format.md (one `Draft` per array item).
import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import { slugify } from '../src/lib/translit'

const MIN_IMAGE_WIDTH = 640 // Media.ts rejects anything narrower (ADR 0013 §7, lowered 2026-10-16)
const IMPORT_CONTEXT = { disableRevalidate: true } // drafts are invisible to the storefront anyway

type Coating = 'gilding' | 'silvering' | 'gold-leaf' | 'enamel' | 'none'

type DraftVariant = {
  title: string
  coating: Coating
  size?: string
  weightKg?: number
  diameterMm?: number
  heightMm?: number
  availability?: 'ready' | 'made-to-order'
  leadTimeText?: string
  costing: {
    supplier: string
    supplierUrl: string
    supplierSku: string
    costRub?: number // absent = price on request (changes.md §13)
    logisticsGel: number
    otherCostsGel?: number
    notes?: string
  }
}

type Draft = {
  key: string
  title: string
  category: { name: string; parent?: string }
  tier?: 'flagship' | 'standard'
  featured?: boolean
  description: string[]
  whyQuality?: string[]
  features?: { label: string; value: string }[]
  photos?: { url: string; alt: string }[]
  variants: DraftVariant[]
}

const COATINGS: Coating[] = ['gilding', 'silvering', 'gold-leaf', 'enamel', 'none']

// Plain paragraphs → Lexical. A line starting with "## " becomes an h2.
function richText(lines: string[]) {
  const base = { direction: null, format: '' as const, indent: 0, version: 1 as const }
  const text = (t: string) => ({ type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: t, version: 1 as const })
  return {
    root: {
      type: 'root' as const,
      ...base,
      children: lines.map((line) =>
        line.startsWith('## ')
          ? { type: 'heading' as const, tag: 'h2' as const, ...base, children: [text(line.slice(3).trim())] }
          : { type: 'paragraph' as const, ...base, children: [text(line)] },
      ),
    },
  }
}

function validate(drafts: unknown): Draft[] {
  if (!Array.isArray(drafts)) throw new Error('JSON root must be an array of drafts')
  const problems: string[] = []
  drafts.forEach((d: Draft, i) => {
    const at = `#${i + 1} ${d?.title ?? '(no title)'}`
    if (!d.key?.startsWith('sofrino:')) problems.push(`${at}: key must be the registry key (sofrino:…)`)
    if (!d.title) problems.push(`${at}: title missing`)
    if (!d.category?.name) problems.push(`${at}: category.name missing`)
    if (!Array.isArray(d.description) || d.description.length === 0) problems.push(`${at}: description must be a non-empty array of paragraphs`)
    if (!Array.isArray(d.variants) || d.variants.length === 0) problems.push(`${at}: at least one variant`)
    d.variants?.forEach((v, j) => {
      if (!v.title) problems.push(`${at} variant ${j + 1}: title missing`)
      if (!COATINGS.includes(v.coating)) problems.push(`${at} variant ${j + 1}: coating must be one of ${COATINGS.join('|')}`)
      const c = v.costing
      if (!c || typeof c.logisticsGel !== 'number' || !c.supplierSku || !c.supplier)
        problems.push(`${at} variant ${j + 1}: costing needs supplier, supplierSku, logisticsGel`)
      if (c && c.costRub !== undefined && typeof c.costRub !== 'number')
        problems.push(`${at} variant ${j + 1}: costRub must be a number or absent (price on request)`)
    })
    // ADR 0005: the public side must not carry supplier data.
    const publicText = JSON.stringify({ t: d.title, d: d.description, w: d.whyQuality, f: d.features, p: d.photos?.map((p) => p.alt) })
    if (/sofrino|софрино|₽|\bруб/i.test(publicText)) problems.push(`${at}: supplier name / rubles found in a public field`)
  })
  if (problems.length) throw new Error(`Invalid drafts:\n- ${problems.join('\n- ')}`)
  return drafts as Draft[]
}

async function upsertCategory(payload: Payload, name: string, parentName?: string): Promise<number> {
  const parentId = parentName ? await upsertCategory(payload, parentName) : undefined
  const { docs } = await payload.find({
    collection: 'categories',
    where: { name: { equals: name } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) return docs[0].id as number
  const doc = await payload.create({
    collection: 'categories',
    data: { name, parent: parentId },
    overrideAccess: true,
    context: IMPORT_CONTEXT,
  })
  console.log(`  + category „${name}“${parentName ? ` (← ${parentName})` : ''}`)
  return doc.id as number
}

async function upsertSupplier(payload: Payload, name: string): Promise<number> {
  const { docs } = await payload.find({ collection: 'suppliers', where: { name: { equals: name } }, limit: 1, overrideAccess: true })
  if (docs[0]) return docs[0].id as number
  // photosAllowed stays false until the owner records the supplier's written permission.
  const doc = await payload.create({ collection: 'suppliers', data: { name, photosAllowed: false }, overrideAccess: true })
  console.log(`  + supplier „${name}“ (photosAllowed: false)`)
  return doc.id as number
}

async function alreadyImported(payload: Payload, draft: Draft): Promise<string | null> {
  const slug = slugify(draft.title)
  const bySlug = await payload.find({ collection: 'products', where: { slug: { equals: slug } }, limit: 1, overrideAccess: true, draft: true })
  if (bySlug.docs[0]) return `product „${slug}“ exists`
  for (const v of draft.variants) {
    const byKey = await payload.find({ collection: 'costings', where: { supplierSku: { equals: v.costing.supplierSku } }, limit: 1, overrideAccess: true })
    if (byKey.docs[0]) return `costing with ${v.costing.supplierSku} exists`
  }
  return null
}

async function downloadPhoto(url: string): Promise<{ data: Buffer; width: number } | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' })
  if (!res.ok) {
    console.warn(`    ! photo ${url}: HTTP ${res.status}`)
    return null
  }
  const data = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(data).metadata()
  if (!meta.width || meta.width < MIN_IMAGE_WIDTH) {
    console.warn(`    ! photo ${url}: ${meta.width ?? '?'}px wide, below ${MIN_IMAGE_WIDTH} — skipped`)
    return null
  }
  // Media.ts converts/validates; we only hand it a JPEG.
  const jpeg = meta.format === 'jpeg' ? data : await sharp(data).jpeg({ quality: 92 }).toBuffer()
  return { data: jpeg, width: meta.width }
}

// `--photos`: for a draft that was already imported but has an empty gallery
// (its photos were rejected or missing at the time), download and attach them.
async function attachMissingPhotos(payload: Payload, draft: Draft, dryRun: boolean): Promise<'imported' | 'skipped'> {
  const slug = slugify(draft.title)
  const { docs } = await payload.find({ collection: 'products', where: { slug: { equals: slug } }, limit: 1, overrideAccess: true, draft: true })
  const product = docs[0]
  if (!product) {
    console.log(`- skip ${draft.key}: not imported yet (run without --photos first)`)
    return 'skipped'
  }
  if ((product.gallery ?? []).length > 0 || !draft.photos?.length) {
    console.log(`- skip ${draft.key}: gallery already has photos or the draft has none`)
    return 'skipped'
  }
  console.log(`+ photos for ${draft.key} „${draft.title}“`)
  if (dryRun) return 'imported'
  const galleryIds: number[] = []
  for (const [i, photo] of draft.photos.entries()) {
    const file = await downloadPhoto(photo.url)
    if (!file) continue
    const media = await payload.create({
      collection: 'media',
      data: { alt: photo.alt },
      file: { data: file.data, mimetype: 'image/jpeg', name: `${slug}-${String(i + 1).padStart(2, '0')}.jpg`, size: file.data.length },
      overrideAccess: true,
      context: IMPORT_CONTEXT,
    })
    galleryIds.push(media.id as number)
  }
  if (galleryIds.length) {
    await payload.update({ collection: 'products', id: product.id, data: { gallery: galleryIds }, draft: true, overrideAccess: true, context: IMPORT_CONTEXT })
  }
  console.log(`    photos: ${galleryIds.length}/${draft.photos.length}`)
  return galleryIds.length ? 'imported' : 'skipped'
}

async function importDraft(payload: Payload, draft: Draft, dryRun: boolean): Promise<'imported' | 'skipped'> {
  const skip = await alreadyImported(payload, draft)
  if (skip) {
    console.log(`- skip ${draft.key}: ${skip}`)
    return 'skipped'
  }
  console.log(`+ ${draft.key} „${draft.title}“`)
  if (dryRun) return 'imported'

  const categoryId = await upsertCategory(payload, draft.category.name, draft.category.parent)
  const slug = slugify(draft.title)

  const galleryIds: number[] = []
  for (const [i, photo] of (draft.photos ?? []).entries()) {
    const file = await downloadPhoto(photo.url)
    if (!file) continue
    const media = await payload.create({
      collection: 'media',
      data: { alt: photo.alt },
      file: { data: file.data, mimetype: 'image/jpeg', name: `${slug}-${String(i + 1).padStart(2, '0')}.jpg`, size: file.data.length },
      overrideAccess: true,
      context: IMPORT_CONTEXT,
    })
    galleryIds.push(media.id as number)
  }
  console.log(`    photos: ${galleryIds.length}/${draft.photos?.length ?? 0}`)

  const product = await payload.create({
    collection: 'products',
    data: {
      title: draft.title,
      category: categoryId,
      tier: draft.tier ?? 'standard',
      featured: draft.featured ?? false,
      description: richText(draft.description),
      whyQuality: draft.whyQuality?.length ? richText(draft.whyQuality) : undefined,
      features: draft.features,
      gallery: galleryIds,
      _status: 'draft',
    },
    draft: true,
    overrideAccess: true,
    context: IMPORT_CONTEXT,
  })

  // The product hook created one default variant — reuse it as variant #1.
  const { docs: defaults } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } }, limit: 1, overrideAccess: true })
  const defaultVariantId = defaults[0]?.id as number | undefined

  for (const [index, v] of draft.variants.entries()) {
    const data = {
      title: v.title,
      coating: v.coating,
      size: v.size,
      weightKg: v.weightKg,
      diameterMm: v.diameterMm,
      heightMm: v.heightMm,
      availability: v.availability ?? 'made-to-order',
      leadTimeText: v.leadTimeText,
      sortOrder: index,
    }
    const variantId =
      index === 0 && defaultVariantId
        ? await payload.update({ collection: 'variants', id: defaultVariantId, data, overrideAccess: true, context: IMPORT_CONTEXT }).then((d) => d.id)
        : await payload.create({ collection: 'variants', data: { product: product.id, ...data }, overrideAccess: true, context: IMPORT_CONTEXT }).then((d) => d.id)

    const supplierId = await upsertSupplier(payload, v.costing.supplier)
    await payload.create({
      collection: 'costings',
      data: {
        variant: variantId,
        supplier: supplierId,
        supplierUrl: v.costing.supplierUrl,
        supplierSku: v.costing.supplierSku,
        costRub: v.costing.costRub,
        logisticsGel: v.costing.logisticsGel,
        otherCostsGel: v.costing.otherCostsGel ?? 0,
        notes: v.costing.notes,
      },
      overrideAccess: true,
    })
  }
  console.log(`    variants: ${draft.variants.length}, status: draft, price: not approved`)
  return 'imported'
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const photosOnly = args.includes('--photos')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) throw new Error('usage: pnpm tsx scripts/catalog-import.ts <drafts.json> [--dry-run] [--photos]')

  const drafts = validate(JSON.parse(await fs.readFile(path.resolve(file), 'utf8')))
  console.log(`${drafts.length} drafts in ${file}${dryRun ? ' (dry run)' : ''}${photosOnly ? ' (photos only)' : ''}`)

  const payload = await getPayload({ config })
  let imported = 0
  let skipped = 0
  for (const draft of drafts) {
    const result = photosOnly ? await attachMissingPhotos(payload, draft, dryRun) : await importDraft(payload, draft, dryRun)
    if (result === 'imported') imported += 1
    else skipped += 1
  }
  console.log(`done: ${imported} imported, ${skipped} skipped`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Payload keeps its pool and jobs alive after we are done — exit explicitly, like seed.ts.
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
