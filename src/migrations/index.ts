import * as migration_20260915_133239_phase1_catalog_and_pricing from './20260915_133239_phase1_catalog_and_pricing';
import * as migration_20260915_143316_phase1_notify_orders_portfolio_pages from './20260915_143316_phase1_notify_orders_portfolio_pages';
import * as migration_20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug from './20260915_154224_phase1_t1_9_delivery_zones_portfolio_slug';
import * as migration_20260916_062520_phase3_custom_requests_share_links from './20260916_062520_phase3_custom_requests_share_links';
import * as migration_20260916_065342_phase5_audit_events from './20260916_065342_phase5_audit_events';
import * as migration_20260916_071643_phase5_seo_contract from './20260916_071643_phase5_seo_contract';
import * as migration_20260918_091811_phase5_audit_user_optional from './20260918_091811_phase5_audit_user_optional';
import * as migration_20260918_111000_s3_prefix_columns from './20260918_111000_s3_prefix_columns';
import * as migration_20260919_074420_pricing_min_markup_gel from './20260919_074420_pricing_min_markup_gel';
import * as migration_20260919_080426_totp_admin_2fa from './20260919_080426_totp_admin_2fa';

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
    name: '20260916_062520_phase3_custom_requests_share_links',
  },
  {
    up: migration_20260916_065342_phase5_audit_events.up,
    down: migration_20260916_065342_phase5_audit_events.down,
    name: '20260916_065342_phase5_audit_events',
  },
  {
    up: migration_20260916_071643_phase5_seo_contract.up,
    down: migration_20260916_071643_phase5_seo_contract.down,
    name: '20260916_071643_phase5_seo_contract',
  },
  {
    up: migration_20260918_091811_phase5_audit_user_optional.up,
    down: migration_20260918_091811_phase5_audit_user_optional.down,
    name: '20260918_091811_phase5_audit_user_optional',
  },
  {
    up: migration_20260918_111000_s3_prefix_columns.up,
    down: migration_20260918_111000_s3_prefix_columns.down,
    name: '20260918_111000_s3_prefix_columns',
  },
  {
    up: migration_20260919_074420_pricing_min_markup_gel.up,
    down: migration_20260919_074420_pricing_min_markup_gel.down,
    name: '20260919_074420_pricing_min_markup_gel',
  },
  {
    up: migration_20260919_080426_totp_admin_2fa.up,
    down: migration_20260919_080426_totp_admin_2fa.down,
    name: '20260919_080426_totp_admin_2fa',
  },
];
