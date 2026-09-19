// M4 + M11 review fix (medium #2) (implementation-plan.md "MVP-მდე"): both
// `pnpm seed` (full, with demo/sentinel data) and `pnpm seed:base` refuse
// NODE_ENV=production, and refuse a non-local DATABASE_URL host regardless
// of NODE_ENV, unless `--allow-prod` is explicitly passed.
import { describe, expect, it } from 'vitest'

import { refusesToRunOnProd } from '../../scripts/seed'

describe('refusesToRunOnProd (seed prod guard)', () => {
  it('refuses --base on NODE_ENV=production', () => {
    expect(refusesToRunOnProd(['--base'], 'production')).toBe(true)
  })

  it('allows --base on NODE_ENV=production with --allow-prod', () => {
    expect(refusesToRunOnProd(['--base', '--allow-prod'], 'production')).toBe(false)
  })

  it('allows --base outside production, on a local DATABASE_URL', () => {
    expect(refusesToRunOnProd(['--base'], 'development', 'postgres://postgres:postgres@127.0.0.1:5433/samkvetlo')).toBe(false)
    expect(refusesToRunOnProd(['--base'], 'test', 'postgres://postgres:postgres@localhost:5433/samkvetlo_test')).toBe(false)
    expect(refusesToRunOnProd(['--base'], undefined)).toBe(false)
  })

  // M11 review fix (medium #2): the full demo seed used to sail through
  // unconditionally — the owner explicitly rejected it ever running on
  // prod (M4). It now gets the exact same guard as --base.
  it('refuses the full seed (no --base) on NODE_ENV=production', () => {
    expect(refusesToRunOnProd([], 'production')).toBe(true)
  })

  it('allows the full seed on NODE_ENV=production with --allow-prod', () => {
    expect(refusesToRunOnProd(['--allow-prod'], 'production')).toBe(false)
  })

  it('refuses a non-local DATABASE_URL host even when NODE_ENV is not production', () => {
    expect(refusesToRunOnProd([], 'development', 'postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/samkvetlo')).toBe(
      true,
    )
    expect(refusesToRunOnProd(['--base'], undefined, 'postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/samkvetlo')).toBe(
      true,
    )
  })

  it('allows a non-local DATABASE_URL host with --allow-prod', () => {
    expect(
      refusesToRunOnProd(['--allow-prod'], 'development', 'postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/samkvetlo'),
    ).toBe(false)
  })

  it('treats localhost, 127.0.0.1 and the docker-compose service name `db` as local', () => {
    expect(refusesToRunOnProd([], 'development', 'postgres://postgres:postgres@localhost:5432/samkvetlo')).toBe(false)
    expect(refusesToRunOnProd([], 'development', 'postgres://postgres:postgres@127.0.0.1:5433/samkvetlo')).toBe(false)
    expect(refusesToRunOnProd([], 'development', 'postgres://postgres:postgres@db:5432/samkvetlo')).toBe(false)
  })

  it('treats a missing DATABASE_URL as local (nothing to protect) but an unparseable one as non-local', () => {
    expect(refusesToRunOnProd([], 'development', undefined)).toBe(false)
    expect(refusesToRunOnProd([], 'development', 'not-a-url')).toBe(true)
  })
})
