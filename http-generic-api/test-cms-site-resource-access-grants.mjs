import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolver = readFileSync('cmsAccountClaimResolver.js', 'utf8');
const connectApi = readFileSync('routes/connectApiRoutes.js', 'utf8');
const migration = readFileSync('migrations/160_sprint66_cms_site_resource_access_grants.sql', 'utf8');

assert(migration.includes('CREATE TABLE IF NOT EXISTS cms_sites'), 'migration must create canonical CMS site resources');
assert(migration.includes('UNIQUE KEY uq_cms_sites_app_domain (app_key, normalized_domain)'), 'cms_sites must prevent duplicate site resources per app/domain');
assert(migration.includes('CREATE TABLE IF NOT EXISTS cms_site_access_grants'), 'migration must create CMS site access grants');
assert(migration.includes('CREATE TABLE IF NOT EXISTS brand_site_bindings'), 'migration must create explicit brand/site bindings');

assert(resolver.includes('async function upsertCmsSite'), 'claim resolver must upsert a canonical cms_sites resource');
assert(resolver.includes('ON DUPLICATE KEY UPDATE') && resolver.includes('normalized_domain'), 'site upsert must reuse existing site by normalized domain');
assert(resolver.includes('async function createSiteAccessGrant'), 'claim resolver must create a site access grant');
assert(resolver.includes('cms_site_access_grants'), 'claim resolver must write cms_site_access_grants');
assert(resolver.includes('draft_allowed') && resolver.includes('publish_allowed'), 'grant must encode draft/publish capabilities');
assert(resolver.includes('requestedScope !== "personal" || !!match.matchedTargetKey'), 'brand/workspace scope or matched brand must require approval');
assert(resolver.includes('site_id: siteId'), 'claim result must expose site_id for follow-up approval/workflow resolution');
assert(resolver.includes('grant_status: grant.status'), 'claim result must expose grant status');
assert(resolver.includes('SELECT brand_name, target_key, brand_domain, base_url, default_wp_api_base'), 'brand matching must use current brands schema');
assert(!resolver.includes('SELECT brand_key, target_key, brand_domain, website_url'), 'brand matching must not rely on legacy/missing brand columns');
assert(!resolver.includes('console.log(applicationPassword'), 'resolver must not log application passwords');

assert(connectApi.includes('cms_site_access_grants'), 'claim approval route must read/update cms_site_access_grants');
assert(connectApi.includes("SET status = 'active'"), 'claim approval route must activate pending grants');
assert(connectApi.includes('grant_promotion: grantPromotion'), 'claim approval response must include grant promotion evidence');
assert(connectApi.includes('secrets_included: false'), 'claim approval route must not return secrets');

console.log('cms site resource access grants tests passed');
