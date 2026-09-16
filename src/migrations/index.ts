import * as migration_20260915_133239_phase1_catalog_and_pricing from './20260915_133239_phase1_catalog_and_pricing';
import * as migration_20260915_143316_phase1_notify_orders_portfolio_pages from './20260915_143316_phase1_notify_orders_portfolio_pages';
import * as migration_20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug from './20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug';
import * as migration_20260916_062520_phase3_custom_requests_share_links from './20260916_062520_phase3_custom_requests_share_links';

export const migrations = [
  {
    up: migration_20260915_133239_phase1_catalog_and_pricing.up,
    down: migration_20260915_133239_phase1_catalog_and_pricing.down,
    name: '20260915_133239_phase1_catalog_and_pricing',
  },
  {
    up: migration_20260915_143316_phase1_notify_orders_portfolio_pages.up,
    down: migration_20260915_143316_phase1_notify_orders_portfolio_pages.down,
    name: '20260915_143316_phase1_notify_orders_portfolio_pages',
  },
  {
    up: migration_20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug.up,
    down: migration_20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug.down,
    name: '20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug',
  },
  {
    up: migration_20260916_062520_phase3_custom_requests_share_links.up,
    down: migration_20260916_062520_phase3_custom_requests_share_links.down,
    name: '20260916_062520_phase3_custom_requests_share_links'
  },
];
