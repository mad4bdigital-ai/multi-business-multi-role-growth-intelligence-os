import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./migrations/178_sprint65_lifecycle_report_snapshots_foundation.sql', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('./databaseTableLifecycle.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('./routes/platformEngineRoutes.js', import.meta.url), 'utf8');
const doc = fs.readFileSync(new URL('../docs/lifecycle-report-snapshots.md', import.meta.url), 'utf8');

assert(migration.includes('CREATE TABLE IF NOT EXISTS platform_lifecycle_report_snapshots'), 'snapshot table must be created');
assert(migration.includes('v_platform_lifecycle_report_snapshot_latest'), 'latest snapshot view must be created');
assert(migration.includes('database_lifecycle_report_snapshots'), 'read admin tool must be registered');
assert(migration.includes('database_lifecycle_report_snapshot_create'), 'create admin tool must be registered');
assert(migration.includes('agent_tool_index'), 'snapshot tools must be indexed');

assert(lifecycle.includes('createDatabaseLifecycleReportSnapshot'), 'create helper must exist');
assert(lifecycle.includes('listDatabaseLifecycleReportSnapshots'), 'list helper must exist');
assert(lifecycle.includes('v_database_lifecycle_growth_hotspots'), 'snapshot must read growth hotspot view');
assert(lifecycle.includes('v_database_lifecycle_credential_review'), 'snapshot must read credential review view');
assert(lifecycle.includes('v_database_lifecycle_backup_snapshot_review'), 'snapshot must read backup snapshot review view');

assert(routes.includes('router.get("/platform/engines/database-table-lifecycle/report-snapshots"'), 'read route must exist');
assert(routes.includes('router.post("/platform/engines/database-table-lifecycle/report-snapshots"'), 'create route must exist');
assert(routes.includes('cleanup_executed: false'), 'snapshot create route must state cleanup is not executed');
assert(routes.includes('archive_executed: false'), 'snapshot create route must state archive is not executed');
assert(routes.includes('destructive_action_executed: false'), 'snapshot create route must state destructive action is not executed');

for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bDELETE\s+FROM\b/i, /archive_executed:\s*true/i, /cleanup_executed:\s*true/i]) {
  assert(!forbidden.test(migration), `snapshot migration must not include destructive operation: ${forbidden}`);
}

assert(doc.includes('evidence-only'), 'docs must state evidence-only boundary');
assert(doc.includes('does not'), 'docs must include non-execution boundaries');
assert(doc.includes('v_database_lifecycle_growth_hotspots'), 'docs must list source views');

console.log('lifecycle report snapshots foundation tests passed');
