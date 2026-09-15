import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPayload } from 'payload'
import config from '../../src/payload.config.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Seeds one `private-files` doc (Local API, overrideAccess) against the same
 * dev DB the running :3001 server uses, for the T1.1 e2e access-control test.
 * Mirrors seedUser.ts's approach of talking to Payload directly rather than
 * through the (admin-only) REST API.
 */
export async function seedPrivateFile(): Promise<{ filename: string; id: number | string }> {
  const payload = await getPayload({ config })
  const data = await fs.readFile(path.resolve(dirname, '../fixtures/sample.pdf'))
  const doc = await payload.create({
    collection: 'private-files',
    data: {},
    file: { data, mimetype: 'application/pdf', name: 'e2e-private-letter.pdf', size: data.length },
    overrideAccess: true,
  })
  return { filename: doc.filename as string, id: doc.id }
}

export async function cleanupPrivateFile(id: number | string): Promise<void> {
  const payload = await getPayload({ config })
  await payload.delete({ collection: 'private-files', id, overrideAccess: true })
}
