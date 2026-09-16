import { addDataAndFileToRequest, type Endpoint, type PayloadRequest } from 'payload'
import type { z, ZodType } from 'zod'

import { CONTRACT_VERSION, ErrorSchema } from '../../shared/contract'
import { checkServiceAuth, type ServiceScope } from '../../server/security/serviceAuth'
import { clientIpFromRequest } from '../../server/security/ipHash'

type HttpMethod = 'connect' | 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put'

interface PublicEndpointConfig<Output extends ZodType, Input extends ZodType | undefined = undefined> {
  /** Mounted under Payload's /api root, e.g. '/public/health' -> GET /api/public/health */
  path: string
  method: HttpMethod
  scope: ServiceScope
  /** When set, the JSON body is parsed and validated before the handler runs (T3.1/T3.3). */
  input?: Input
  output: Output
  /**
   * Set for a write-scope endpoint whose handler calls `ipHashFromRequest`
   * (rate limiting) — a missing/empty `x-client-ip` would otherwise hash to
   * the same bucket for every caller instead of failing closed (ADR 0014
   * §2, review finding MAJOR 1).
   */
  requireClientIp?: boolean
  handler: (
    req: PayloadRequest,
    input: Input extends ZodType ? z.infer<Input> : undefined,
  ) => Promise<z.infer<Output>>
}

function errorResponse(code: string, status: number, fields?: Record<string, string>): Response {
  const body: z.infer<typeof ErrorSchema> = fields ? { error: { code, fields } } : { error: { code } }
  return Response.json(body, { status })
}

/** Thrown by a handler to produce a 404 (e.g. an unknown slug) — publicEndpoint catches it. */
export class PublicNotFoundError extends Error {
  constructor() {
    super('err.notFound')
  }
}

/**
 * Thrown by a handler for any other non-2xx response (400/403/409/429 —
 * e.g. an unknown delivery zone, a failed Turnstile check, a rate limit, a
 * cart line that's no longer purchasable). `fields` is the same shape
 * publicEndpoint itself builds for a zod validation failure.
 */
export class PublicHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(status: number, code: string, fields?: Record<string, string>) {
    super(code)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/**
 * Builds the `fields` map for a zod validation failure — keyed by the
 * top-level field name, valued by the issue's own message. Every OrderInput
 * field's message is one of exactly 'required' | 'tooLong' | 'invalid'
 * (chief-architect, T3.2), so the frontend can pick a Georgian string from
 * ka.ts without parsing a composite code. `deliveryZone` additionally gets
 * mirrored into the top-level `code` (err.deliveryZone.required/invalid)
 * since that field has its own dedicated error codes end-to-end.
 */
function validationErrorResponse(error: z.ZodError): Response {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (key === undefined) continue
    fields[String(key)] = issue.message
  }

  const code = fields.deliveryZone ? `err.deliveryZone.${fields.deliveryZone}` : 'err.validation'
  return errorResponse(code, 400, Object.keys(fields).length > 0 ? fields : undefined)
}

/**
 * Wraps a /api/public/* handler with service-token auth, input validation
 * and output validation (ADR 0005 layer 3, ADR 0012 §3-4). The handler's
 * return value is checked against `output` before it is ever sent; an
 * unknown key fails closed (500).
 */
export function publicEndpoint<Output extends ZodType, Input extends ZodType | undefined = undefined>(
  config: PublicEndpointConfig<Output, Input>,
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

      if (config.requireClientIp && !clientIpFromRequest(req)) {
        return errorResponse('err.clientIp.missing', 400)
      }

      let input: z.infer<NonNullable<Input>> | undefined
      // `Input` is a generic type parameter, so TS can't narrow
      // `config.input` from truthiness alone — the cast below just names
      // what the runtime check already guarantees.
      const inputSchema = config.input as ZodType | undefined
      if (inputSchema) {
        // Payload custom endpoints don't populate req.data on their own
        // (ADR 0012 §3 read_first note) — this parses the JSON body into it.
        await addDataAndFileToRequest(req)
        const parsed = inputSchema.safeParse(req.data ?? {})
        if (!parsed.success) {
          return validationErrorResponse(parsed.error)
        }
        input = parsed.data as z.infer<NonNullable<Input>>
      }

      let result: z.infer<Output>
      try {
        result = await config.handler(req, input as Input extends ZodType ? z.infer<Input> : undefined)
      } catch (err) {
        if (err instanceof PublicNotFoundError) {
          return errorResponse('err.notFound', 404)
        }
        if (err instanceof PublicHttpError) {
          return errorResponse(err.code, err.status, err.fields)
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
