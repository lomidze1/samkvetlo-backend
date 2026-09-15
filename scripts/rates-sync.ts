// ADR 0006: local equivalent of the GET /api/cron/exchange-rates endpoint —
// fetches today's NBG rate, upserts it, and recomputes every costing.
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { fetchNbgRates } from '../src/server/rates/nbg'
import { recomputeCostingsForNewRate } from '../src/server/rates/recompute'

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  const rates = await fetchNbgRates()
  const isoDate = new Date(rates.date).toISOString()

  const { docs: existing } = await payload.find({
    collection: 'exchange-rates',
    where: { date: { equals: isoDate } },
    limit: 1,
    overrideAccess: true,
  })

  if (existing[0]) {
    await payload.update({
      collection: 'exchange-rates',
      id: existing[0].id,
      data: { rubGel: rates.rubGel, usdGel: rates.usdGel, source: 'nbg', fetchedAt: new Date().toISOString() },
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: 'exchange-rates',
      data: {
        date: isoDate,
        rubGel: rates.rubGel,
        usdGel: rates.usdGel,
        source: 'nbg',
        fetchedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
  }

  const result = await recomputeCostingsForNewRate(payload)
  console.log(`rates:sync — ${isoDate}: rubGel=${rates.rubGel} usdGel=${rates.usdGel}`, result)
  process.exit(0)
}

main().catch((error) => {
  console.error('rates:sync failed', error)
  process.exit(1)
})
