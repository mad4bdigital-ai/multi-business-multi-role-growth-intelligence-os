import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('routes/localManagerDesktopCommandRoutes.js', 'utf8');

assert(source.includes('ALL_ZERO_TENANT_ID'), 'desktop command resolver must define the all-zero tenant sentinel');
assert(source.includes('function isWildcardTenantId'), 'desktop command resolver must normalize empty/all-zero tenant as wildcard');
assert(source.includes('async function resolveEffectiveDesktopCommandTarget'), 'enqueue must resolve effective polling identity before insert');
assert(source.includes('loadActiveDeviceAliasRows'), 'resolver must use active device alias rows');
assert(source.includes('local_connector_device_aliases'), 'resolver must consult local connector device alias registry');
assert(source.includes("status IN ('claimed','completed')"), 'resolver must prefer recent claimed/completed polling history');
assert(source.includes('local_connector_user_configs'), 'resolver must fallback to active connector config for new/unclaimed devices');
assert(source.includes('fallback_new_or_unlinked_device'), 'resolver must not fail new devices with no mapping yet');
assert(source.includes('requested_user_id'), 'request context must preserve requested user id');
assert(source.includes('requested_tenant_id'), 'request context must preserve requested tenant id');
assert(source.includes('requested_device_id'), 'request context must preserve requested device id');
assert(source.includes('effective_tenant_id'), 'request context must expose effective tenant id');
assert(source.includes('effective_device_id'), 'request context must expose effective device id');
assert(source.includes('canonical_device_id'), 'request context must expose canonical device id');
assert(source.includes('identity_resolution_source'), 'request context must include identity resolution source');
assert(source.includes('identity_resolution_status'), 'request context must include identity resolution status');
assert(source.includes('target.tenant_id') && source.includes('target.device_id'), 'enqueue insert must use the resolved target identity');
assert(source.includes('identity_resolution: target.request_context?.desktop_identity_resolution'), 'enqueue response must return sanitized resolution evidence');
assert(source.includes('OR tenant_id = ?') && source.includes('ALL_ZERO_TENANT_ID'), 'poll/complete queries must allow all-zero queued commands within same user/device alias');
assert(source.includes('AND (user_id = ? OR user_id IS NULL)'), 'alias lookup must remain scoped to the same user or global alias only');
assert(!source.includes('identity_resolution_source: "essam"'), 'resolver must not hardcode Essam-specific resolution');
assert(!source.includes('00000000-0000-4000-a000-000000000001'), 'resolver must not hardcode Essam tenant id');

console.log('local manager desktop identity resolution tests passed');
