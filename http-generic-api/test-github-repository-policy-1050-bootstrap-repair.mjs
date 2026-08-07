import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { splitMigrationSqlStatements } from './migrationSqlStatements.js';

const repairUrl = new URL('./migrations/1050_github_repository_policy_controller_bootstrap_repair.sql', import.meta.url);
const sourceUrl = new URL('./migrations/20260805_github_repository_policy_controller.sql', import.meta.url);
const overlayUrl = new URL('./migrations/1049_github_repository_policy_single_owner_mode.sql', import.meta.url);

const [repairSql, sourceSql, overlaySql] = await Promise.all([
  readFile(repairUrl, 'utf8'),
  readFile(sourceUrl, 'utf8'),
  readFile(overlayUrl, 'utf8'),
]);

const statements = splitMigrationSqlStatements(repairSql);
assert.equal(statements.length, 7, 'repair migration must remain a bounded seven-statement registration repair');

const requiredSurfaces = [
  'INSERT INTO execution_policies',
  'INSERT INTO admin_platform_endpoint_tools',
  'INSERT INTO platform_plugin_capabilities',
  'INSERT INTO platform_plugin_bindings',
  'INSERT INTO platform_plugin_capability_exports',
  'INSERT INTO governed_migration_authorization_registry',
];
for (const surface of requiredSurfaces) {
  assert.ok(repairSql.includes(surface), `missing canonical repair surface: ${surface}`);
}

const criticalUpserts = statements.filter((statement) =>
  /INSERT INTO (execution_policies|admin_platform_endpoint_tools|platform_plugin_capabilities|platform_plugin_bindings|platform_plugin_capability_exports)/.test(statement)
);
assert.equal(criticalUpserts.length, 5, 'all five canonical registration surfaces must be materialized explicitly');
for (const statement of criticalUpserts) {
  assert.match(statement, /ON DUPLICATE KEY UPDATE/i, 'critical bootstrap surfaces must be duplicate-safe UPSERTs');
}

assert.doesNotMatch(
  repairSql,
  /UPDATE\s+(execution_policies|platform_plugin_capabilities)\s+SET/i,
  'repair must not depend on UPDATE-only materialization for critical rows'
);
assert.doesNotMatch(
  repairSql,
  /UPDATE\s+admin_platform_endpoint_tools\s+SET[\s\S]*WHERE\s+tool_key\s+IN\s*\(\s*'github_repository_policy_controller'/i,
  'repository policy tool rows must be materialized by UPSERT rather than UPDATE-only logic'
);

assert.match(repairSql, /'github_repository_policy_controller_v1'/);
assert.match(repairSql, /'github_repository_policy_controller'/);
assert.match(repairSql, /'repository_automation_policy_controller'/);
assert.match(repairSql, /'repository_policy_controller'/);
assert.match(repairSql, /'binding:admin:github_repository_policy_controller'/);
assert.match(repairSql, /'export:admin:github_repository_policy_controller'/);

assert.match(repairSql, /'review_policy_mode','auto_single_owner_or_independent'/);
assert.match(repairSql, /'single_owner_gate_check','Single Owner Review Gate'/);
assert.match(repairSql, /'single_owner_exact_head_attestation_required',TRUE/);
assert.match(repairSql, /'single_owner_mode',JSON_OBJECT\(/);
assert.match(repairSql, /'type','boolean'/);
assert.match(repairSql, /'required_approving_review_count_single_owner',0/);
assert.match(repairSql, /'required_approving_review_count_independent',1/);
assert.match(repairSql, /'Single Owner Review Gate'/);

assert.match(repairSql, /'live_github_policy_apply',false/);
assert.match(repairSql, /'live_apply_authorized',false/);
assert.match(repairSql, /'force_push_allowed',FALSE/);
assert.match(repairSql, /'repository_content_mutation_allowed',FALSE/);
assert.match(repairSql, /'protected_ref_mutation',false/);
assert.match(repairSql, /'external_writes',false/);
assert.match(repairSql, /'provider_calls',false/);
assert.match(repairSql, /'secrets_included',false/);
assert.doesNotMatch(repairSql, /\b(DELETE|DROP|TRUNCATE|REPLACE)\b/i, 'repair must remain additive and non-destructive');

assert.match(repairSql, /'canonical_bootstrap_source','20260805_github_repository_policy_controller\.sql'/);
assert.match(repairSql, /'repairs_migration','1049_github_repository_policy_single_owner_mode\.sql'/);
assert.match(repairSql, /'1050_github_repository_policy_controller_bootstrap_repair\.sql'/);

assert.ok(sourceSql.includes("'github_repository_policy_controller_v1'"), 'canonical source migration must still define the policy row');
assert.ok(sourceSql.includes("'binding:admin:github_repository_policy_controller'"), 'canonical source migration must still define the binding');
assert.ok(sourceSql.includes("'export:admin:github_repository_policy_controller'"), 'canonical source migration must still define the export');
assert.ok(overlaySql.includes("UPDATE execution_policies"), '1049 remains an overlay migration and must not be rewritten/retried by this repair');
assert.ok(overlaySql.includes("'auto_single_owner_or_independent'"), 'repair must preserve 1049 single-owner mode semantics');

console.log(`PASS ${fileURLToPath(repairUrl)}: ${statements.length} bounded idempotent repair statements`);
