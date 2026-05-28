import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _testingTenantRepoDocRoutes } from './routes/tenantRepoDocRoutes.js';

const routeFile = readFileSync('routes/tenantRepoDocRoutes.js', 'utf8');
const indexFile = readFileSync('routes/index.js', 'utf8');
const migration = readFileSync('migrations/161_sprint65_tenant_repo_doc_read_tool.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');
const tenantInstructions = readFileSync('../GPT_Tenant_Connector_Instructions.md', 'utf8');
const tenantKnowledge = readFileSync('../GPT_Tenant_Connector_Knowledge.md', 'utf8');
const liveRepoDoc = readFileSync('../docs/live-repo-knowledge-loading-governance.md', 'utf8');

assert(routeFile.includes('export function buildTenantRepoDocRoutes'), 'tenant repo doc route builder must be exported');
assert(routeFile.includes('/tenant/repo-docs/read'), 'tenant repo doc read route must exist');
assert(routeFile.includes('requireTenantUserJwt'), 'tenant repo doc route must require user JWT');
assert(routeFile.includes('fetchActiveMembershipForTenant'), 'tenant repo doc route must require active membership');
assert(routeFile.includes('TENANT_SAFE_DOCS'), 'tenant repo doc route must use explicit allowlist');
assert(routeFile.includes('BLOCKED_PATHS'), 'tenant repo doc route must maintain explicit blocklist');
assert(routeFile.includes('AI_Agent_Knowledge_Guide.md'), 'tenant repo doc reader must block admin AI guide');
assert(routeFile.includes('GPT_Admin_Assistant_Knowledge_Guide.md'), 'tenant repo doc reader must block admin GPT guide');
assert(routeFile.includes('secrets_included: false'), 'tenant repo doc route must mark responses as secret-free');
assert(routeFile.includes('redactPotentialSecrets'), 'tenant repo doc route must redact obvious secret patterns defensively');
assert(!routeFile.includes('repo_inspect'), 'tenant route must not reuse admin repo_inspect');

assert(indexFile.includes('buildTenantRepoDocRoutes'), 'routes index must import tenant repo doc routes');
assert(indexFile.includes('app.use(buildTenantRepoDocRoutes())'), 'tenant repo doc routes must be mounted');
assert(routeFile.includes('tenant_safe_repo_doc_allowlist'), 'tenant repo doc route must expose its allowlist policy source');

assert(migration.includes('tenant_repo_doc_read'), 'tenant repo doc read tool must be registered');
assert(migration.includes('tenant_platform_endpoint_tools'), 'tenant repo doc tool must target tenant tool registry');
assert(migration.includes('/tenant/repo-docs/read'), 'tenant repo doc tool must target route');
assert(migration.includes('tenant_safe'), 'tenant repo doc tool must be tagged tenant_safe');
assert(migration.includes('allowlist'), 'tenant repo doc tool must be tagged allowlist');
assert(migration.includes('no_secrets'), 'tenant repo doc tool must be tagged no_secrets');
assert(migration.includes('live_repo'), 'tenant repo doc tool must be tagged live_repo');

assert(openapi.includes('/tenant/repo-docs/read:'), 'OpenAPI must document tenant repo doc read route');
assert(openapi.includes('operationId: tenantRepoDocRead'), 'OpenAPI must expose stable tenant repo doc read operationId');
assert(openapi.includes('Blocks\n        admin guides'), 'OpenAPI must document admin guide blocking');

assert(tenantInstructions.includes('tenant_repo_doc_read') || tenantInstructions.includes('tenant-exposed live docs'), 'tenant instructions should mention tenant-safe live docs');
assert(tenantKnowledge.includes('tenant_repo_doc_read'), 'tenant knowledge must document tenant repo doc read tool');
assert(liveRepoDoc.includes('tenant_repo_doc_read'), 'live repo governance doc must document implemented tenant docs reader');

const allowed = Object.keys(_testingTenantRepoDocRoutes.TENANT_SAFE_DOCS);
assert(allowed.includes('GPT_Tenant_Connector_Instructions.md'), 'tenant compact instructions must be allowlisted');
assert(allowed.includes('GPT_Tenant_Connector_Knowledge.md'), 'tenant knowledge must be allowlisted');
assert(!allowed.includes('AI_Agent_Knowledge_Guide.md'), 'admin AI guide must not be allowlisted');
assert(_testingTenantRepoDocRoutes.BLOCKED_PATHS.has('AI_Agent_Knowledge_Guide.md'), 'admin AI guide must be explicitly blocked');
assert.equal(_testingTenantRepoDocRoutes.normalizeDocPath('/docs/tenant-platform-plugin-self-serve.md'), 'docs/tenant-platform-plugin-self-serve.md');

const redacted = _testingTenantRepoDocRoutes.redactPotentialSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789');
assert(redacted.includes('[redacted]'), 'secret redaction must mask bearer-like tokens');

const listResult = await _testingTenantRepoDocRoutes.readTenantSafeRepoDoc({});
assert.equal(listResult.action, 'list');
assert(listResult.allowed_docs.some((doc) => doc.path === 'GPT_Tenant_Connector_Instructions.md'));
assert.equal(listResult.secrets_included, false);

const readResult = await _testingTenantRepoDocRoutes.readTenantSafeRepoDoc({ path: 'GPT_Tenant_Connector_Instructions.md', max_chars: 1500 });
assert.equal(readResult.action, 'read');
assert.equal(readResult.path, 'GPT_Tenant_Connector_Instructions.md');
assert.equal(readResult.secrets_included, false);
assert(readResult.content.includes('Mad4B Tenant Assistant Instructions'));

await assert.rejects(
  () => _testingTenantRepoDocRoutes.readTenantSafeRepoDoc({ path: 'AI_Agent_Knowledge_Guide.md' }),
  /not tenant-safe|not allowlisted/
);
await assert.rejects(
  () => _testingTenantRepoDocRoutes.readTenantSafeRepoDoc({ path: '../README.md' }),
  /not tenant-safe|not allowlisted/
);

console.log('tenant repo doc read tests passed');
