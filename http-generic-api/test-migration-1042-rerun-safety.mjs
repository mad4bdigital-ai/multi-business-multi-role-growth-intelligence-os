import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationFile = "1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql";
const migration = readFileSync(`migrations/${migrationFile}`, "utf8");
const canonicalMigration = migration.replace(/\r\n?/g, "\n");
const migrationSha256 = createHash("sha256").update(canonicalMigration, "utf8").digest("hex");
const canonicalStatements = splitMigrationSqlStatements(migration);
const preflight = assessMigrationSqlPreflight(migrationFile, migration);
const preflightRiskCounts = Object.fromEntries(
  Object.entries((preflight.risks || []).reduce((counts, risk) => {
    counts[risk.code] = (counts[risk.code] || 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)),
);
const statements = migration
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

function statementContaining(token) {
  const matches = statements.filter((statement) => statement.includes(token));
  assert.equal(matches.length, 1, `expected exactly one Migration 1042 statement containing ${token}`);
  return matches[0];
}

assert.equal(canonicalStatements.length, 12, "Migration 1042 canonical statement count must remain 12");
assert.equal(Number(preflight.counts?.statements || 0), canonicalStatements.length, "Migration 1042 preflight and canonical parser statement counts must agree");
assert.match(migrationSha256, /^[0-9a-f]{64}$/, "Migration 1042 canonical checksum must be SHA-256");

assert.match(
  migration,
  /Additive\/re-runnable\. Time-dependent SLA reconciliation may legitimately update derived status on a later run\./,
  "Migration 1042 must describe rerun semantics accurately rather than claim strict time-independent idempotency",
);

const testTicketBackfill = statementContaining("d3f6d691-48b8-489d-950e-a7230a996b0b");
assert.match(testTicketBackfill, /updated_at\s*=\s*NOW\(\)/, "test-ticket normalization should preserve its audit timestamp update when a logical change occurs");
assert.match(testTicketBackfill, /COALESCE\(is_test,\s*0\)\s*<>\s*1/, "test-ticket backfill must skip rows already marked as test");
assert.match(testTicketBackfill, /COALESCE\(environment,\s*''\)\s*=\s*''/, "test-ticket backfill must run when environment normalization is still needed");
assert.match(testTicketBackfill, /COALESCE\(visibility_class,\s*''\)\s*<>\s*'internal_test'/, "test-ticket backfill must run when visibility normalization is still needed");

const wordpressTicketBackfill = statementContaining("310f39c8-d2f7-4523-95db-9a783c59f9cf");
assert.match(wordpressTicketBackfill, /updated_at\s*=\s*NOW\(\)/, "WordPress linkage backfill should preserve its audit timestamp update when a logical change occurs");
assert.match(wordpressTicketBackfill, /parent_ticket_id\s+IS\s+NULL/, "WordPress linkage backfill must skip reruns once parent linkage is present");
assert.match(wordpressTicketBackfill, /related_ticket_id\s+IS\s+NULL/, "WordPress linkage backfill must skip reruns once related linkage is present");
assert.match(wordpressTicketBackfill, /target_capability\s+IS\s+NULL/, "WordPress linkage backfill must skip reruns once target capability is present");

const resolvedBackfill = statementContaining("685dc4d9-c137-4941-81f4-de13306a8508");
assert.match(resolvedBackfill, /status\s+IN\s*\('open',\s*'in_review',\s*'awaiting_approval'\)/, "resolved-ticket backfill must already be state-guarded on rerun");

console.log(JSON.stringify({
  contract: "mad4b.migration-1042-rerun-safety.v1",
  migration_sha256: migrationSha256,
  checksum_canonicalization: "utf8_lf_v1",
  statement_count: canonicalStatements.length,
  preflight_status: preflight.status,
  preflight_risk_count: Number(preflight.risk_count || 0),
  preflight_risks: preflightRiskCounts,
  live_database_connected: false,
  migration_apply_executed: false,
  secrets_included: false,
}));
console.log("Migration 1042 rerun safety tests passed");
