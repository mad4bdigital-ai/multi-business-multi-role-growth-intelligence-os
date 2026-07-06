import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "./releaseReadiness.js";

const migration = readFileSync("migrations/1036_sprint69_governance_debt_cleanup.sql", "utf8");
const statements = splitSqlStatements(migration);

assert.equal(statements.length, 3, "governance debt cleanup must remain a small three-statement migration");
assert.match(migration, /INSERT INTO admin_platform_endpoint_tools/);
assert.match(migration, /platform_resource_authority_grant_apply/);
assert.match(migration, /INSERT INTO governed_migration_authorization_registry/);
assert.match(migration, /\bmigration_file\b/);
assert.match(migration, /authorization_status/);
assert.match(migration, /allow_apply/);
assert.match(migration, /20260705_registry_skill_recovery_and_execution_log_certification\.sql/);
assert.match(migration, /1004_sprint69_growth_agent_migration_reconciliation_policy\.sql/);
assert.match(migration, /20260704_platform_resource_authority_grant_tool\.sql/);
assert.doesNotMatch(migration, /\bmigration_key\b/);
assert.doesNotMatch(migration, /\bmigration_path\b/);
assert.doesNotMatch(migration, /\brisk_class\b/);
assert.doesNotMatch(migration, /authorized_for_review/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);

const envelopeUpdate = statements.find((statement) => /UPDATE\s+capability_resolution_envelope_ledger/i.test(statement));
assert(envelopeUpdate, "expired envelope cleanup statement must be present");
assert.match(envelopeUpdate, /WHERE[\s\S]*expires_at IS NOT NULL/i);
assert.match(envelopeUpdate, /WHERE[\s\S]*expires_at < UTC_TIMESTAMP\(\)/i);
assert.match(envelopeUpdate, /WHERE[\s\S]*envelope_status IN \('ready_for_dispatch','ready_requires_approval','dry_run'\)/i);
assert.match(envelopeUpdate, /WHERE[\s\S]*execution_status <> 'executed'/i);
assert.doesNotMatch(envelopeUpdate, /\bDELETE\b/i);

console.log("governance debt cleanup migration tests passed");
