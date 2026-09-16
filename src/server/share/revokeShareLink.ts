import type { Payload } from 'payload'

import type { ShareLinkRevokeInput, ShareLinkRevokeResult } from '../../shared/contract/shareLink'
import { PublicHttpError } from '../../endpoints/public/publicEndpoint'
import { constantTimeEqualHex, hashOwnerSecret, hashToken } from './token'

/**
 * T3.8 (ADR 0011 §1). An unknown token, a missing ownerSecret and a wrong
 * ownerSecret all fail identically (403) — no oracle for guessing a token
 * via this endpoint either. Revoking an already-revoked link is a no-op
 * (idempotent).
 */
export async function revokeShareLink(payload: Payload, input: ShareLinkRevokeInput): Promise<ShareLinkRevokeResult> {
  const { docs } = await payload.find({
    collection: 'share-links',
    where: { tokenHash: { equals: hashToken(input.token) } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = docs[0]

  if (!doc || !constantTimeEqualHex(doc.ownerSecretHash, hashOwnerSecret(input.ownerSecret ?? ''))) {
    throw new PublicHttpError(403, 'err.shareLink.forbidden')
  }

  if (!doc.revokedAt) {
    await payload.update({
      collection: 'share-links',
      id: doc.id,
      data: { revokedAt: new Date().toISOString() },
      overrideAccess: true,
    })
  }

  return { ok: true }
}
