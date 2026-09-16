import { test, expect } from '@playwright/test'
import { cleanupPrivateFile, seedPrivateFile } from '../helpers/seedPrivateFile'

// T1.1 (ADR 0005/0013) access + size gaps: a too-large upload must be
// rejected with 413 (payload.config.ts's root upload.limits.fileSize, before
// any collection access check runs), and a private file must never be
// servable to an anonymous request.
test.describe('uploads: size limit + private-files access (T1.1)', () => {
  test('a 5 MB upload is rejected with 413, before any auth/collection check', async ({ request }) => {
    // Root upload.limits.fileSize = 4_000_000 B (payload.config.ts). Body size
    // is checked before collection access, so this works fully anonymously
    // and against any upload collection — media is used here since it's public.
    const fiveMb = Buffer.alloc(5_000_000, 1)

    const response = await request.post('/api/media', {
      multipart: {
        file: {
          name: 'big.jpg',
          mimeType: 'image/jpeg',
          buffer: fiveMb,
        },
        _payload: JSON.stringify({ alt: 'e2e too-large upload' }),
      },
    })

    expect(response.status()).toBe(413)
  })

  test('anonymous GET /api/private-files/file/<name> is rejected (401/403)', async ({ request }) => {
    const { id, filename } = await seedPrivateFile()
    try {
      const response = await request.get(`/api/private-files/file/${filename}`)
      expect([401, 403]).toContain(response.status())
    } finally {
      await cleanupPrivateFile(id)
    }
  })
})
