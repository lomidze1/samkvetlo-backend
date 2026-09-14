import { createHash, timingSafeEqual } from 'node:crypto'
import type { PayloadRequest } from 'payload'

export type ServiceScope = 'read' | 'write'
export type ServiceAuthResult = 'forbidden' | 'ok' | 'unauthorized'

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Constant-time string comparison via sha256 digests (equal-length buffers). */
function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

function bearerToken(req: PayloadRequest): string {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

/**
 * ADR 0012 §4: service token auth for /api/public/*.
 * - missing/unknown token -> 'unauthorized' (401)
 * - known token but insufficient scope (read token on a write endpoint) -> 'forbidden' (403)
 * - SERVICE_TOKEN_WRITE also satisfies scope "read" (write implies read)
 */
export function checkServiceAuth(req: PayloadRequest, scope: ServiceScope): ServiceAuthResult {
  const token = bearerToken(req)
  if (!token) return 'unauthorized'

  const readToken = process.env.SERVICE_TOKEN_READ ?? ''
  const writeToken = process.env.SERVICE_TOKEN_WRITE ?? ''

  const isWrite = Boolean(writeToken) && constantTimeEqual(token, writeToken)
  const isRead = Boolean(readToken) && constantTimeEqual(token, readToken)

  if (!isWrite && !isRead) return 'unauthorized'
  if (scope === 'write' && !isWrite) return 'forbidden'
  return 'ok'
}
