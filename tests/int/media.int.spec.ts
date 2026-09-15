// file-type's Uint8Array/Buffer instanceof checks need the real Node realm;
// jsdom's own TypedArray globals are a different realm and fail the check.
// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { SENTINEL } from '../fixtures/sentinel'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
// Default Payload upload.staticDir === collection slug, resolved relative to cwd (ADR 0013 §1: dev = local disk).
const MEDIA_DIR = path.resolve(process.cwd(), 'media')

async function loadFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, name))
}

const createdMediaIds: (number | string)[] = []

describe('media collection (T1.1, ADR 0005 layer 4 / ADR 0013)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of createdMediaIds) {
      await payload.delete({ collection: 'media', id }).catch(() => undefined)
    }
  })

  it('renames the uploaded file so the original filename never reaches the DB or storage', async () => {
    const data = await loadFixture('product-3000x2000.jpg')
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'ტესტის ფოტო' },
      file: { data, mimetype: 'image/jpeg', name: SENTINEL.filename, size: data.length },
    })
    createdMediaIds.push(doc.id)

    const serialized = JSON.stringify(doc).toLowerCase()
    expect(serialized).not.toContain('zzsent')
    expect(doc.filename).not.toMatch(/zzsent/i)
    // ADR 0005: renamed to a UUID + the *detected* extension (jpg, from magic bytes).
    expect(doc.filename).toMatch(/^[0-9a-f-]{36}\.jpg$/)
  })

  it('generates all 5 WebP sizes + the OG JPEG, named "{uuid}-{size}.{ext}", within the ADR 0013 §8 byte budgets', async () => {
    const data = await loadFixture('product-3000x2000.jpg')
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'ტესტის ფოტო' },
      file: { data, mimetype: 'image/jpeg', name: 'product.jpg', size: data.length },
    })
    createdMediaIds.push(doc.id)

    const uuid = doc.filename?.replace(/\.jpg$/, '')
    const sizes = doc.sizes as Record<string, { filename?: string | null; filesize?: number | null }>

    const budgets: Record<string, number> = { w320: 25_000, w640: 60_000, w1280: 150_000 }
    const measured: Record<string, number> = {}

    for (const name of ['w320', 'w640', 'w960', 'w1280', 'w1920']) {
      expect(sizes[name]?.filename).toBe(`${uuid}-${name}.webp`)
      measured[name] = sizes[name]?.filesize ?? 0
    }
    expect(sizes.og?.filename).toBe(`${uuid}-og.jpg`)
    measured.og = sizes.og?.filesize ?? 0

    for (const [name, budget] of Object.entries(budgets)) {
      // Reported (not weakened): measured byte size vs. the ADR 0013 §8 budget.
      expect(measured[name], `${name}: measured ${measured[name]} B, budget ${budget} B`).toBeLessThanOrEqual(
        budget,
      )
    }
  })

  it('computes a blurDataURL placeholder (≤ 1 KB decoded)', async () => {
    const data = await loadFixture('product-3000x2000.jpg')
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'ტესტის ფოტო' },
      file: { data, mimetype: 'image/jpeg', name: 'product.jpg', size: data.length },
    })
    createdMediaIds.push(doc.id)

    const blurDataURL = (doc as { blurDataURL?: string | null }).blurDataURL
    expect(blurDataURL).toMatch(/^data:image\/webp;base64,/)
    const base64 = blurDataURL!.split(',')[1] ?? ''
    const decodedBytes = Buffer.from(base64, 'base64').length
    expect(decodedBytes, `measured ${decodedBytes} B`).toBeLessThanOrEqual(1024)
  })

  it('strips EXIF (incl. GPS) from the stored original and from every generated size', async () => {
    const data = await loadFixture('product-3000x2000.jpg')
    // Sanity check: the fixture actually carries GPS + Artist EXIF before upload.
    const sourceMeta = await sharp(data).metadata()
    expect(sourceMeta.exif).toBeDefined()

    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'ტესტის ფოტო' },
      file: { data, mimetype: 'image/jpeg', name: 'product.jpg', size: data.length },
    })
    createdMediaIds.push(doc.id)

    const originalBuffer = await fs.readFile(path.join(MEDIA_DIR, doc.filename!))
    const originalMeta = await sharp(originalBuffer).metadata()
    expect(originalMeta.exif).toBeUndefined()

    const sizes = doc.sizes as Record<string, { filename?: string | null }>
    for (const name of ['w320', 'w640', 'w960', 'w1280', 'w1920']) {
      const filename = sizes[name]?.filename
      expect(filename).toBeTruthy()
      const buffer = await fs.readFile(path.join(MEDIA_DIR, filename!))
      const meta = await sharp(buffer).metadata()
      expect(meta.exif, `${name} should have no EXIF`).toBeUndefined()
    }
  })

  it('rejects a photo narrower than 1280 px', async () => {
    const data = await loadFixture('product-1000-narrow.jpg')
    await expect(
      payload.create({
        collection: 'media',
        data: { alt: 'ტესტის ფოტო' },
        file: { data, mimetype: 'image/jpeg', name: 'narrow.jpg', size: data.length },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  // Code review fix (T1.1–T1.8): re-encoding without .rotate() drops the
  // EXIF Orientation tag but keeps the *stored* (pre-rotation) pixel grid,
  // so a portrait phone photo saved with Orientation=6 (rotate 90° CW to
  // display correctly) came out sideways once the tag telling viewers to
  // rotate it was gone.
  it('bakes in EXIF Orientation before stripping metadata, so a sideways-stored photo ends up portrait', async () => {
    const data = await loadFixture('orientation-6-landscape.jpg')
    const sourceMeta = await sharp(data).metadata()
    expect(sourceMeta.orientation).toBe(6)
    expect(sourceMeta.width).toBeGreaterThan(sourceMeta.height ?? 0)

    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'ტესტის ფოტო (orientation)' },
      file: { data, mimetype: 'image/jpeg', name: 'orientation.jpg', size: data.length },
    })
    createdMediaIds.push(doc.id)

    const originalBuffer = await fs.readFile(path.join(MEDIA_DIR, doc.filename!))
    const originalMeta = await sharp(originalBuffer).metadata()
    expect(originalMeta.orientation).toBeUndefined()
    expect(originalMeta.width).toBeLessThan(originalMeta.height ?? 0)
  })

  it('rejects a file whose magic bytes do not match its extension (PDF renamed to .jpg) with 415', async () => {
    const data = await loadFixture('fake-pdf-as-jpg.jpg')
    await expect(
      payload.create({
        collection: 'media',
        data: { alt: 'ტესტის ფოტო' },
        file: { data, mimetype: 'image/jpeg', name: 'fake.jpg', size: data.length },
      }),
    ).rejects.toMatchObject({ status: 415 })
  })
})
