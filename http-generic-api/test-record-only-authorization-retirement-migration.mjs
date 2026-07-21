import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "./releaseReadiness.js";

const migration = readFileSync("migrations/1037_sprint69_record_only_authorization_retirement.sql", "utf8");
const statements = splitSqlStatements(migration);

assert.equal(statements.length, 2, "record-only authorization retirement must remain a small two-statement migration");
assert.match(migration, /UPDATE governed_migration_authorization_registry a/);
assert.match(migration, /authorization_status = 'disabled'/);
assert.match(migration, /legacy_record_only_authorization_retired/);
assert.match(migration, /EXISTS \([\s\S]*governed_migration_ledger l[\s\S]*l\.mode = 'record_only'/);
assert.match(migration, /NOT EXISTS \([\s\S]*governed_migration_ledger applied[\s\S]*applied\.mode = 'apply'/);
assert.match(migration, /051_sprint48_cloudflare_and_self_repair_tools\.sql/);
assert.match(migration, /1025_sprint69_activation_archive_dynamic_control_authority\.sql/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(migration, /\bmigration_key\b/);
assert.doesNotMatch(migration, /\bmigration_path\b/);
assert.doesNotMatch(migration, /\brisk_class\b/);

const envelopeUpdate = statements.find((statement) => /UPDATE\s+capability_resolution_envelope_ledger/i.test(statement));
assert(envelopeUpdate, "expired referenced envelope cleanup statement must be present");
assert.match(envelopeUpdate, /WHERE[\s\S]*expires_at IS NOT NULL/i);
assert.match(envelopeUpdate, /WHERE[\s\S]*expires_at < UTC_TIMESTAMP\(\)/i);
assert.match(envelopeUpdate, /WHERE[\s\S]*execution_status <> 'executed'/i);
assert.doesNotMatch(envelopeUpdate, /\bDELETE\b/i);

console.log("record-only authorization retirement migration tests passed");
