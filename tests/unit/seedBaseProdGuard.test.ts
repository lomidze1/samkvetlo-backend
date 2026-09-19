// M4 (implementation-plan.md "MVP-მდე"): `pnpm seed:base` refuses
// NODE_ENV=production unless `--allow-prod` is explicitly passed.
import { describe, expect, it } from 'vitest'

import { refusesToRunOnProd } from '../../scripts/seed'

describe('refusesToRunOnProd (seed:base prod guard)', () => {
  it('refuses --base on NODE_ENV=production', () => {
    expect(refusesToRunOnProd(['--base'], 'production')).toBe(true)
  })

  it('allows --base on NODE_ENV=production with --allow-prod', () => {
    expect(refusesToRunOnProd(['--base', '--allow-prod'], 'production')).toBe(false)
  })

  it('allows --base outside production', () => {
    expect(refusesToRunOnProd(['--base'], 'development')).toBe(false)
    expect(refusesToRunOnProd(['--base'], 'test')).toBe(false)
    expect(refusesToRunOnProd(['--base'], undefined)).toBe(false)
  })

  it('never refuses the full seed (no --base), even on production', () => {
    expect(refusesToRunOnProd([], 'production')).toBe(false)
  })
})
