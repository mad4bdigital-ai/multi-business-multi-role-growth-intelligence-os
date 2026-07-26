import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeFile = readFileSync('routes/platformEvolutionRoutes.js', 'utf8');
const migration = readFileSync('migrations/162_sprint65_cms_claim_smoke_tool.sql', 'utf8');

assert(routeFile.includes('/platform/evolution/cms-claim-smoke'), 'CMS claim smoke route must exist');
assert(routeFile.includes('directCmsClaimApprovalSmoke'), 'CMS claim direct smoke helper must exist');
assert(routeFile.includes('issueInternalTenantSmokeJwt'), 'CMS claim smoke must issue internal short-lived User JWT');
assert(routeFile.includes('jwt.verify'), 'CMS claim smoke must verify internal User JWT');
assert(routeFile.includes('cms_account_claims'), 'CMS claim smoke must exercise cms_account_claims');
assert(routeFile.includes('credential_bindings'), 'CMS claim smoke must exercise credential binding promotion');
assert(routeFile.includes('getEffectiveCredentialStatus'), 'CMS claim smoke must read back effective credential status');
assert(routeFile.includes('effective_owner_type === "tenant"'), 'CMS claim smoke must require tenant-owned effective credential');
assert(routeFile.includes('secret_copied: false'), 'CMS claim smoke must not copy secrets');
assert(routeFile.includes('token_returned: false'), 'CMS claim smoke must not return tokens');
assert(routeFile.includes('secrets_included: false'), 'CMS claim smoke must not return secrets');
assert(!routeFile.includes('includeSecret: true'), 'CMS claim smoke must not request secret inclusion');

assert(migration.includes('platform_evolution_cms_claim_smoke'), 'CMS claim smoke admin tool must be registered');
assert(migration.includes('/platform/evolution/cms-claim-smoke'), 'CMS claim smoke path must be registered');
assert(migration.includes('no_secrets'), 'CMS claim smoke tool must be tagged no_secrets');
assert(migration.includes('no_token_returned'), 'CMS claim smoke tool must be tagged no_token_returned');
assert(migration.includes('no_secret_copy'), 'CMS claim smoke tool must be tagged no_secret_copy');
assert(migration.includes('direct_scope'), 'CMS claim smoke tool must be tagged direct_scope');

console.log('platform evolution CMS claim smoke tests passed');
