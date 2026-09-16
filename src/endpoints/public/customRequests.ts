import type { File as UploadFile, PayloadRequest } from 'payload'

import { CustomRequestInputSchema, CustomRequestResultSchema } from '../../shared/contract/customRequest'
import { submitCustomRequest } from '../../server/customRequests/submitCustomRequest'
import type { UploadedAttachment } from '../../server/customRequests/attachments'
import { clientIpFromRequest, ipHashFromRequest } from '../../server/security/ipHash'
import { publicEndpoint } from './publicEndpoint'

/**
 * multipart/form-data body: `_payload` field holds the JSON matching
 * CustomRequestInputSchema (parsed into req.data by addDataAndFileToRequest,
 * called by publicEndpoint before this handler runs); every repeated
 * `attachments` file field lands here, keyed by field name.
 */
function collectAttachments(req: PayloadRequest): UploadedAttachment[] {
  const raw = req.files?.attachments
  if (!raw) return []
  const files: UploadFile[] = Array.isArray(raw) ? raw : [raw]
  return files.map((file) => ({ data: file.data, name: file.name }))
}

export const customRequestsEndpoint = publicEndpoint({
  path: '/public/custom-requests',
  method: 'post',
  scope: 'write',
  requireClientIp: true,
  input: CustomRequestInputSchema,
  output: CustomRequestResultSchema,
  handler: async (req, input) =>
    submitCustomRequest(req.payload, input, collectAttachments(req), {
      ipHash: ipHashFromRequest(req),
      clientIp: clientIpFromRequest(req),
    }),
})
