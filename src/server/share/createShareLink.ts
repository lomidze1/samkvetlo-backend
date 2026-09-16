import type { Payload } from 'payload'

import type { ShareLinkCreateInput, ShareLinkCreateResult } from '../../shared/contract/shareLink'
import { PublicHttpError } from '../../endpoints/public/publicEndpoint'
import { isRateLimited } from '../security/rateLimit'
import { generateOwnerSecret, generateToken, hashOwnerSecret, hashToken } from './token'

export interface CreateShareLinkContext {
  ipHash: string
}

/**
 * T3.8 (ADR 0011 §1, ADR 0014 §2/§13). Rate limit 20/10min, TTL from
 * site-settings.shareLinkTtlDays (default 90, D18). The DB only ever sees
 * the token's hash — `token`/`ownerSecret` are returned once and never
 * stored anywhere else (frontend keeps ownerSecret in localStorage).
 */
export async function createShareLink(
  payload: Payload,
  input: ShareLinkCreateInput,
  ctx: CreateShareLinkContext,
): Promise<ShareLinkCreateResult> {
  const limited = await isRateLimited(payload, {
    collection: 'share-links',
    ipHash: ctx.ipHash,
    windowMs: 10 * 60 * 1000,
    max: 20,
  })
  if (limited) throw new PublicHttpError(429, 'err.rateLimited')

  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  const ttlDays = settings.shareLinkTtlDays ?? 90
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const token = generateToken()
  const ownerSecret = generateOwnerSecret()

  await payload.create({
    collection: 'share-links',
    data: {
      kind: input.kind,
      tokenHash: hashToken(token),
      ownerSecretHash: hashOwnerSecret(ownerSecret),
      cartLines: input.cartLines,
      expiresAt,
      viewCount: 0,
      ipHash: ctx.ipHash,
    },
    overrideAccess: true,
  })

  return { token, ownerSecret, expiresAt }
}
