import type { Endpoint, PayloadRequest } from 'payload'
import type { z, ZodType } from 'zod'

import { CONTRACT_VERSION, ErrorSchema } from '../../shared/contract'
import { checkServiceAuth, type ServiceScope } from '../../server/security/serviceAuth'

type HttpMethod = 'connect' | 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put'

interface PublicEndpointConfig<Output extends ZodType> {
  /** Mounted under Payload's /api root, e.g. '/public/health' -> GET /api/public/health */
  path: string
  method: HttpMethod
  scope: ServiceScope
  output: Output
  handler: (req: PayloadRequest) => Promise<z.infer<Output>>
}

function errorResponse(code: string, status: number): Response {
  const body: z.infer<typeof ErrorSchema> = { error: { code } }
  return Response.json(body, { status })
}

/** Thrown by a handler to produce a 404 (e.g. an unknown slug) — publicEndpoint catches it. */
export class PublicNotFoundError extends Error {
  constructor() {
    super('err.notFound')
  }
}

/**
 * Code review finding: thrown by a handler to produce a 400 with an error
 * code (e.g. a zod parse failure on query params) — publicEndpoint catches
 * it. Distinct from PublicNotFoundError: a malformed request (unknown
 * `type`, missing `path`, ...) is a client error, not "no such resource".
 */
export class PublicBadRequestError extends Error {
  readonly code: string
  constructor(code = 'err.validation') {
    super(code)
    this.code = code
  }
}

/**
 * Wraps a /api/public/* handler with service-token auth and output validation
 * (ADR 0005 layer 3, ADR 0012 §3-4). The handler's return value is checked
 * against `output` before it is ever sent; an unknown key fails closed (500).
 */
export function publicEndpoint<Output extends ZodType>(
  config: PublicEndpointConfig<Output>,
): Endpoint {
  return {
    path: config.path,
    method: config.method,
    handler: async (req: PayloadRequest): Promise<Response> => {
      const auth = checkServiceAuth(req, config.scope)
      if (auth === 'unauthorized') {
        return errorResponse('err.unauthorized', 401)
      }
      if (auth === 'forbidden') {
        return errorResponse('err.forbidden', 403)
      }

      let result: z.infer<Output>
      try {
        result = await config.handler(req)
      } catch (err) {
        if (err instanceof PublicNotFoundError) {
          return errorResponse('err.notFound', 404)
        }
        if (err instanceof PublicBadRequestError) {
          return errorResponse(err.code, 400)
        }
        throw err
      }

      const parsed = config.output.safeParse(result)
      if (!parsed.success) {
        req.payload.logger.error(
          { err: parsed.error, path: config.path },
          'publicEndpoint: output failed contract schema',
        )
        return errorResponse('err.internal', 500)
      }

      return Response.json(parsed.data, {
        headers: { 'x-contract-version': CONTRACT_VERSION },
      })
    },
  }
}
