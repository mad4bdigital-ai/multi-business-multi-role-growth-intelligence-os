import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const migrationPath = new URL(
  "./migrations/20260725_ueacp_performance_retention_indexes.sql",
  import.meta.url
);
const sql = readFileSync(migrationPath, "utf8");
const checksum = createHash("sha256").update(sql).digest("hex");

assert.equal(
  checksum,
  "f58dd46bedd780796fdeeaf044812fc545fbed53933314eda4d87e53afd2234d",
  "UEACP performance/retention index migration checksum changed"
);

const statements = sql
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
assert.equal(statements.length, 3, "migration must contain exactly three statements");

assert.match(
  statements[0],
  /CREATE INDEX IF NOT EXISTS idx_ueacp_connected_systems_tenant_cursor\s+ON connected_systems \(tenant_id, system_id, status\)/i
);
assert.match(
  statements[1],
  /CREATE INDEX IF NOT EXISTS idx_ueacp_installations_system_tenant_state\s+ON installations \(system_id, tenant_id, status, expires_at\)/i
);
assert.match(
  statements[2],
  /CREATE INDEX IF NOT EXISTS idx_ueacp_shadow_decisions_expires\s+ON effective_authority_shadow_decisions \(expires_at\)/i
);

assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|ALTER)\b/i);
assert.doesNotMatch(sql, /credential|secret|token|provider_payload/i);

console.log("UEACP performance and retention index migration tests passed");
