import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./migrations/172_sprint65_database_lifecycle_reporting_views.sql', import.meta.url), 'utf8');
const doc = fs.readFileSync(new URL('../docs/database-lifecycle-reporting-views.md', import.meta.url), 'utf8');

const requiredViews = [
  'v_database_lifecycle_status_summary',
  'v_database_lifecycle_owner_coverage',
  'v_database_lifecycle_growth_hotspots',
  'v_database_lifecycle_placeholder_review',
  'v_database_lifecycle_high_risk_review',
  'v_database_lifecycle_credential_review',
  'v_database_lifecycle_backup_snapshot_review',
];

for (const viewName of requiredViews) {
  assert(migration.includes(`CREATE OR REPLACE VIEW ${viewName}`), `${viewName} must be created by migration 172`);
  assert(doc.includes(viewName), `${viewName} must be documented`);
}

assert(migration.includes('database_table_lifecycle_registry'), 'views must read from lifecycle registry');
assert(migration.includes("usage_status = 'planned_placeholder'"), 'placeholder review must be explicit');
assert(migration.includes("risk_level = 'high'"), 'high-risk review must be explicit');
assert(migration.includes("owner_engine_key = 'credential_governance_engine'"), 'credential review must be tied to credential governance owner');
assert(migration.includes("usage_status = 'backup_snapshot'"), 'backup snapshot review must be explicit');
assert(migration.includes("tool_key = 'database_table_lifecycle_decision_brief'"), 'admin tool description should mention reporting visibility');

for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(migration), `reporting migration must not include destructive SQL statement ${destructiveSql}`);
}

assert(!/\bUPDATE\s+database_table_lifecycle_registry\b/i.test(migration), 'reporting views must not mutate lifecycle rows');
assert(doc.includes('visibility surfaces only'), 'docs must state the read-only reporting boundary');
assert(doc.includes('do not drop, truncate, delete, archive, or mutate'), 'docs must state destructive actions are outside scope');

console.log('database lifecycle reporting views contract tests passed');
