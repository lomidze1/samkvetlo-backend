import { CONTRACT_VERSION, HealthSchema } from '../../shared/contract'
import { publicEndpoint } from './publicEndpoint'

export const healthEndpoint = publicEndpoint({
  path: '/public/health',
  method: 'get',
  scope: 'read',
  output: HealthSchema,
  handler: async () => ({ ok: true as const, contractVersion: CONTRACT_VERSION }),
})
