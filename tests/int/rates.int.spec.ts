import fs from 'node:fs/promises'
import path from 'node:path'
import type { PayloadRequest } from 'payload'

import { cronRatesEndpoint } from '@/endpoints/cronRates'
import { parseNbgRates, type NbgDayEntry } from '@/server/rates/nbg'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')

describe('NBG rates (T1.6, ADR 0006)', () => {
  it('parses the fixture (RUB rate 3.0923, quantity 100) into rubGel = 0.030923', async () => {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, 'nbg-sample.json'), 'utf8')
    const response = JSON.parse(raw) as NbgDayEntry[]

    const rates = parseNbgRates(response)

    expect(rates.rubGel).toBeCloseTo(0.030923, 6)
    expect(rates.usdGel).toBeCloseTo(2.6095, 4)
    expect(rates.date).toBe('2026-09-12T00:00:00.000Z')
  })

  it('throws if the response is empty', () => {
    expect(() => parseNbgRates([])).toThrow()
  })

  it('throws if RUB or USD is missing', () => {
    expect(() =>
      parseNbgRates([{ date: '2026-09-12', currencies: [{ code: 'EUR', quantity: 1, rate: 2.8 }] }]),
    ).toThrow()
  })
})

describe('GET /api/cron/exchange-rates (T1.6)', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  function fakeReq(headers: Record<string, string>): PayloadRequest {
    return { headers: new Headers(headers) } as unknown as PayloadRequest
  }

  it('without a bearer token returns 401', async () => {
    const response = await cronRatesEndpoint.handler(fakeReq({}))
    expect(response.status).toBe(401)
  })

  it('with the wrong bearer token returns 401', async () => {
    const response = await cronRatesEndpoint.handler(fakeReq({ authorization: 'Bearer wrong' }))
    expect(response.status).toBe(401)
  })

  it('when CRON_SECRET is not configured, every request is 401', async () => {
    process.env.CRON_SECRET = ''
    const response = await cronRatesEndpoint.handler(fakeReq({ authorization: 'Bearer test-cron-secret' }))
    expect(response.status).toBe(401)
  })
})
