// See media.int.spec.ts: file-type needs the real Node Uint8Array realm.
// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload, type AccessArgs, type Payload } from 'payload'
import config from '@/payload.config'

import { PrivateFiles } from '@/collections/PrivateFiles'
import { PublicFiles } from '@/collections/PublicFiles'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')

async function loadFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, name))
}

/** ADR 0005 T1 unit style: call collection access functions directly with an anonymous request. */
const anonymousAccess = { req: { user: null } } as unknown as AccessArgs

const cleanup: Array<() => Promise<void>> = []

describe('public-files / private-files (T1.1, ADR 0005 layer 1+4 / ADR 0013 §1)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const fn of cleanup) await fn().catch(() => undefined)
  })

  it('public-files: is publicly readable', async () => {
    expect(await PublicFiles.access!.read!(anonymousAccess)).toBe(true)
  })

  it('private-files: is not readable by an anonymous request (ADR 0005 T1 unit)', async () => {
    expect(await PrivateFiles.access!.read!(anonymousAccess)).toBe(false)
  })

  it('private-files: create/update/delete are also admin-only', async () => {
    for (const op of ['create', 'update', 'delete'] as const) {
      expect(await PrivateFiles.access![op]!(anonymousAccess)).toBe(false)
    }
  })

  it('public-files: renames the uploaded PDF and detects a magic-byte mismatch', async () => {
    const pdf = await loadFixture('sample.pdf')
    const doc = await payload.create({
      collection: 'public-files',
      data: {},
      file: { data: pdf, mimetype: 'application/pdf', name: 'zzsent-certificate.pdf', size: pdf.length },
    })
    cleanup.push(async () => {
      await payload.delete({ collection: 'public-files', id: doc.id })
    })

    expect(doc.filename).not.toMatch(/zzsent/i)
    expect(doc.filename).toMatch(/^[0-9a-f-]{36}\.pdf$/)

    // A real JPEG (not PDF/MP3/M4A) mislabeled as an MP3 — magic bytes say
    // "image/jpeg", which public-files does not allow, so this must be a 415
    // regardless of the client-supplied mimetype/extension.
    const wrongType = await loadFixture('product-3000x2000.jpg')
    await expect(
      payload.create({
        collection: 'public-files',
        data: {},
        file: { data: wrongType, mimetype: 'audio/mpeg', name: 'sound.mp3', size: wrongType.length },
      }),
    ).rejects.toMatchObject({ status: 415 })
  })

  it('private-files: renames the uploaded PDF the same way', async () => {
    const pdf = await loadFixture('sample.pdf')
    const doc = await payload.create({
      collection: 'private-files',
      data: {},
      file: { data: pdf, mimetype: 'application/pdf', name: 'zzsent-letter.pdf', size: pdf.length },
      overrideAccess: true,
    })
    cleanup.push(async () => {
      await payload.delete({ collection: 'private-files', id: doc.id, overrideAccess: true })
    })

    expect(doc.filename).not.toMatch(/zzsent/i)
    expect(doc.filename).toMatch(/^[0-9a-f-]{36}\.pdf$/)
  })
})
