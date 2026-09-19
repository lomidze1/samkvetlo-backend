import { describe, expect, it } from 'vitest'

// Code review finding: `pnpm test:e2e` (the only place
// tests/e2e/headers.e2e.spec.ts's X-Robots-Tag assertion lives) never runs
// in CI (.github/workflows/ci.yml only runs test:unit/test:int) — starting
// a real server and Playwright browsers in CI for one static header is a
// lot of machinery for what this config object already answers directly.
// Chosen fix: a unit test on the actual `next.config.ts` default export
// (not a duplicated constant), which `pnpm test:unit` already runs in CI.
// The e2e spec stays as the real-HTTP-response check for local/pre-release
// verification (ADR: same pattern samkvetlo/next.config.ts uses for CSP).
describe('next.config.ts headers() (T5.x SEO contract, CI coverage)', () => {
  it('sends X-Robots-Tag: noindex, nofollow on every path', async () => {
    const { default: config } = await import('../../next.config')
    const headerGroups = await config.headers!()

    const robotsHeader = headerGroups
      .flatMap((group) => group.headers ?? [])
      .find((header) => header.key === 'X-Robots-Tag')

    expect(robotsHeader).toEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' })
  })
})
