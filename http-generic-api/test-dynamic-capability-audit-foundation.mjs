import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('./migrations/179_sprint66_dynamic_capability_audit_foundation.sql', import.meta.url),
  'utf8'
);
const doc = fs.readFileSync(
  new URL('../docs/dynamic-capability-audit-foundation.md', import.meta.url),
  'utf8'
);
const tenantOpenApi = fs.readFileSync(new URL('./openapi.tenant-gpt.auth.yaml', import.meta.url), 'utf8');
const releaseReadiness = fs.readFileSync(new URL('./releaseReadiness.js', import.meta.url), 'utf8');
const governedMigrationRunner = fs.readFileSync(
  new URL('./scripts/governed-migration-runner.mjs', import.meta.url),
  'utf8'
);

const requiredTables = [
  'platform_audit_event_bus',
  'repo_file_audit_runs',
  'repo_file_audit_findings',
  'asset_audit_events',
  'db_change_audit_events',
  'checkpoint_auto_rollups',
];

for (const tableName of requiredTables) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS \`${tableName}\``), `${tableName} must be created`);
  assert(doc.includes(tableName), `${tableName} must be documented`);
}

const requiredViews = [
  'v_platform_capabilities_current',
  'v_platform_bindings_current',
  'v_platform_exports_current',
  'v_platform_capability_maturity',
  'v_platform_capability_gaps',
];

for (const viewName of requiredViews) {
  assert(migration.includes(`CREATE OR REPLACE VIEW \`${viewName}\``), `${viewName} must be created`);
  assert(doc.includes(viewName), `${viewName} must be documented`);
}

for (const sourceTable of [
  'admin_platform_endpoint_tools',
  'tenant_platform_endpoint_tools',
  'platform_engine_registry',
  'platform_engine_policy_registry',
  'app_integration_tool_bindings',
  'resource_authority_route_family_registry',
  'runtime_dispatch_certification_registry',
  'platform_plugin_contributions',
]) {
  assert(migration.includes(sourceTable), `capability foundation must read ${sourceTable}`);
}

for (const requiredPhrase of [
  'does not enable watchers',
  'does not execute mutations',
  'does not create tenant routes',
  'compatibility views',
  'evidence intake',
]) {
  assert(doc.includes(requiredPhrase), `docs must state ${requiredPhrase}`);
}

assert(migration.includes('dispatch_not_allowed'), 'gap view must expose dispatch gaps');
assert(migration.includes('authority_evidence_missing'), 'gap view must expose authority evidence gaps');
assert(migration.includes('active_export_missing'), 'gap view must expose export gaps');
assert(migration.includes('maturity_score'), 'maturity view must compute a maturity score');
assert(migration.includes('maturity_status'), 'maturity view must compute a maturity status');
assert(migration.includes('source_event_key'), 'audit tables must support event correlation');
assert(migration.includes('commit_sha'), 'repo/checkpoint audit tables must support commit correlation');
assert(
  releaseReadiness.includes('179_sprint66_dynamic_capability_audit_foundation.sql'),
  'release readiness governed ledger expectation must include migration 179'
);
assert(
  governedMigrationRunner.includes('179_sprint66_dynamic_capability_audit_foundation.sql'),
  'governed migration runner allowlist must include migration 179'
);

for (const destructiveSql of [
  /^\s*DROP\s+TABLE\b/mi,
  /^\s*TRUNCATE\s+TABLE\b/mi,
  /^\s*DELETE\s+FROM\b/mi,
  /^\s*UPDATE\s+(?!`?admin_platform_endpoint_tools`?\b)/mi,
]) {
  assert(!destructiveSql.test(migration), `foundation migration must not include destructive SQL statement ${destructiveSql}`);
}

for (const forbiddenExposure of [
  'platform_audit_event_bus',
  'repo_file_audit_runs',
  'repo_file_audit_findings',
  'asset_audit_events',
  'db_change_audit_events',
  'checkpoint_auto_rollups',
  'v_platform_capabilities_current',
  'v_platform_capability_maturity',
]) {
  assert(!tenantOpenApi.includes(forbiddenExposure), `tenant OpenAPI must not expose ${forbiddenExposure}`);
}

console.log('dynamic capability audit foundation contract tests passed');
