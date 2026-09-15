import * as migration_20260915_133239_phase1_catalog_and_pricing from './20260915_133239_phase1_catalog_and_pricing';

export const migrations = [
  {
    up: migration_20260915_133239_phase1_catalog_and_pricing.up,
    down: migration_20260915_133239_phase1_catalog_and_pricing.down,
    name: '20260915_133239_phase1_catalog_and_pricing'
  },
];
