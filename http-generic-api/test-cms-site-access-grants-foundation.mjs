import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/162_sprint66_cms_site_resource_access_grants.sql', 'utf8');

assert(migration.includes('CREATE TABLE IF NOT EXISTS cms_sites'), 'cms_sites table must be additive');
assert(migration.includes('UNIQUE KEY uq_cms_sites_app_domain (app_key, normalized_domain)'), 'cms_sites must prevent duplicate resource rows per app/domain');
assert(migration.includes('CREATE TABLE IF NOT EXISTS cms_site_access_grants'), 'cms_site_access_grants table must be additive');
assert(migration.includes('UNIQUE KEY uq_cms_site_grant_scope'), 'cms_site_access_grants must prevent duplicate grants for the same scoped connection');
assert(migration.includes('draft_allowed tinyint(1)'), 'grants must encode draft permission');
assert(migration.includes('publish_allowed tinyint(1)'), 'grants must encode publish permission');
assert(migration.includes('destructive_allowed tinyint(1)'), 'grants must encode destructive operation permission');
assert(migration.includes('CREATE TABLE IF NOT EXISTS brand_site_bindings'), 'brand_site_bindings table must keep brand/site relationship explicit');

console.log('cms site access grants foundation schema test passed');
