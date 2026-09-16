import {
  PublicShareDTOSchema,
  ShareLinkCreateInputSchema,
  ShareLinkCreateResultSchema,
  ShareLinkRevokeInputSchema,
  ShareLinkRevokeResultSchema,
} from '../../shared/contract/shareLink'
import { createShareLink } from '../../server/share/createShareLink'
import { revokeShareLink } from '../../server/share/revokeShareLink'
import { getPublicShareByToken } from '../../server/public/share'
import { ipHashFromRequest } from '../../server/security/ipHash'
import { publicEndpoint, PublicNotFoundError } from './publicEndpoint'

export const shareLinkCreateEndpoint = publicEndpoint({
  path: '/public/share-links',
  method: 'post',
  scope: 'write',
  input: ShareLinkCreateInputSchema,
  output: ShareLinkCreateResultSchema,
  handler: async (req, input) => createShareLink(req.payload, input, { ipHash: ipHashFromRequest(req) }),
})

export const shareLinkRevokeEndpoint = publicEndpoint({
  path: '/public/share-links/revoke',
  method: 'post',
  scope: 'write',
  input: ShareLinkRevokeInputSchema,
  output: ShareLinkRevokeResultSchema,
  handler: async (req, input) => revokeShareLink(req.payload, input),
})

export const shareByTokenEndpoint = publicEndpoint({
  path: '/public/share/:token',
  method: 'get',
  scope: 'read',
  output: PublicShareDTOSchema,
  handler: async (req) => {
    const token = req.routeParams?.token
    if (typeof token !== 'string') throw new PublicNotFoundError()
    const dto = await getPublicShareByToken(req.payload, token)
    if (!dto) throw new PublicNotFoundError()
    return dto
  },
})
