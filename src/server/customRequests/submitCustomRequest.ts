import type { Payload } from 'payload'

import type { CustomRequest } from '../../payload-types'
import type { CustomRequestInput, CustomRequestResult } from '../../shared/contract/customRequest'
import { PublicHttpError } from '../../endpoints/public/publicEndpoint'
import { isRateLimited } from '../security/rateLimit'
import { verifyTurnstile } from '../security/turnstile'
import { validateAttachments, type UploadedAttachment, type ValidatedAttachment } from './attachments'
import { notifyCustomRequestCreated } from './notifyCustomRequest'

export interface SubmitCustomRequestContext {
  ipHash: string
  clientIp: string
}

type ExistingRequest = Pick<CustomRequest, 'number'>

async function findBySubmissionId(payload: Payload, submissionId: string): Promise<ExistingRequest | null> {
  const { docs } = await payload.find({
    collection: 'custom-requests',
    where: { submissionId: { equals: submissionId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

async function createAttachmentDocs(payload: Payload, files: ValidatedAttachment[]): Promise<number[]> {
  const ids: number[] = []
  for (const file of files) {
    const doc = await payload.create({
      collection: 'private-files',
      data: {},
      file: { data: file.data, mimetype: file.mimeType, name: file.name, size: file.data.length },
      overrideAccess: true,
    })
    ids.push(doc.id)
  }
  return ids
}

/**
 * T3.7 (ADR 0011 §3, ADR 0003 §4's pipeline order + its ADR 0012 §4 update).
 * Step order: idempotency -> Turnstile -> rate limit -> attachments ->
 * create -> notify. Every non-2xx outcome after the zod input schema is a
 * thrown PublicHttpError, caught by publicEndpoint.
 */
export async function submitCustomRequest(
  payload: Payload,
  input: CustomRequestInput,
  files: UploadedAttachment[],
  ctx: SubmitCustomRequestContext,
): Promise<CustomRequestResult> {
  // Idempotency: a repeated submissionId returns the same number without
  // touching Turnstile again (a token is single-use) and without
  // re-validating/re-uploading attachments.
  const existing = await findBySubmissionId(payload, input.submissionId)
  if (existing) return { number: existing.number ?? '' }

  const verified = await verifyTurnstile({
    token: input.turnstileToken,
    remoteIp: ctx.clientIp,
    idempotencyKey: input.submissionId,
  })
  if (!verified) throw new PublicHttpError(403, 'err.turnstile')

  const limited = await isRateLimited(payload, {
    collection: 'custom-requests',
    ipHash: ctx.ipHash,
    windowMs: 10 * 60 * 1000,
    max: 5,
  })
  if (limited) throw new PublicHttpError(429, 'err.rateLimited')

  const validatedFiles = await validateAttachments(files)
  const attachmentIds = await createAttachmentDocs(payload, validatedFiles)

  const requestData = {
    submissionId: input.submissionId,
    name: input.name,
    surname: input.surname,
    phone: input.phone,
    church: input.church,
    city: input.city,
    email: input.email,
    category: input.category,
    product: input.product,
    description: input.description,
    attachments: attachmentIds,
    budgetText: input.budgetText,
    deadlineText: input.deadlineText,
    status: 'new' as const,
    ipHash: ctx.ipHash,
  }

  let request: CustomRequest
  try {
    request = await payload.create({ collection: 'custom-requests', data: requestData, overrideAccess: true })
  } catch (err) {
    // A concurrent double-submit can race past the check above — the DB's
    // unique constraint on submissionId is the real guard (ADR 0003 §5).
    const raced = await findBySubmissionId(payload, input.submissionId)
    if (raced) return { number: raced.number ?? '' }
    throw err
  }

  await notifyCustomRequestCreated(payload, request)

  return { number: request.number ?? '' }
}
