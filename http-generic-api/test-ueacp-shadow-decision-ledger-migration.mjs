import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const migrationUrl = new URL(
  "./migrations/20260721_ueacp_shadow_decision_ledger.sql",
  import.meta.url
);
const sql = readFileSync(migrationUrl, "utf8");
const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
const statements = splitMigrationSqlStatements(sql);

assert.equal(
  checksum,
  "07d71161456d8415a798f81818b981da733339c15d58f13b904eddbdde079b82"
);
assert.equal(statements.length, 2);
assert.match(sql, /CREATE TABLE IF NOT EXISTS `effective_authority_shadow_decisions`/i);
assert.match(sql, /CREATE TABLE IF NOT EXISTS `authority_projection_drift_events`/i);
assert.match(sql, /chk_effective_authority_shadow_non_authoritative/i);
assert.match(sql, /chk_authority_projection_drift_non_authoritative/i);
assert.match(sql, /`enforcement_mode` = 'shadow_only'/i);
assert.match(sql, /`authority_granted` = 0/i);
assert.match(sql, /`provider_call_made` = 0/i);
assert.match(sql, /`credential_payload_read` = 0/i);
assert.match(sql, /`external_write_made` = 0/i);
assert.match(sql, /`secrets_included` = 0/i);
assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);

console.log("UEACP shadow decision ledger migration tests passed");
