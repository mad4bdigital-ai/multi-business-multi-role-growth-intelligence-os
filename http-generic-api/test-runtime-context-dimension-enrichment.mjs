import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/205_sprint67_runtime_context_dimension_enrichment.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.ok(migration.includes("UPDATE telemetry_spans ts"), "migration should enrich telemetry spans");
assert.ok(migration.includes("JOIN workflow_runs wr"), "telemetry enrichment should use workflow_runs linkage");
assert.ok(migration.includes("UPDATE audit_log al"), "migration should enrich audit log rows");
assert.ok(migration.includes("JOIN execution_plans ep"), "audit enrichment should use execution_plans linkage");
assert.ok(migration.includes("CREATE OR REPLACE VIEW v_runtime_context_dimension_enrichment_fillable"), "migration should expose fillable diagnostics view");

for (const token of ["tenant_id", "user_id", "actor_id", "actor_type", "brand_id", "brand_key", "workspace_id", "workspace_key", "request_id", "session_id", "conversation_id", "correlation_id", "execution_context_json"]) {
  assert.ok(migration.includes(token), `migration should handle ${token}`);
}

for (const destructive of [/DROP\s+TABLE/i, /TRUNCATE\s+TABLE/i, /DELETE\s+FROM/i, /ALTER\s+TABLE/i]) {
  assert.doesNotMatch(migration, destructive, `enrichment migration must not include ${destructive}`);
}

assert.doesNotMatch(migration, /secrets_included['"]?\s*,\s*true/i, "enrichment context must not mark secrets included");
assert.ok(runner.includes("205_sprint67_runtime_context_dimension_enrichment.sql"), "migration must be allowlisted for governed runner");

console.log("runtime context dimension enrichment migration tests passed");
