import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/256_sprint68_dynamic_audit_pipeline_readiness.sql", import.meta.url), "utf8");

assert.match(migration, /v_dynamic_audit_pipeline_counts/);
assert.match(migration, /v_dynamic_audit_pipeline_quality/);
assert.match(migration, /v_dynamic_audit_pipeline_readiness/);
assert.match(migration, /audit_log_to_event_bus_gap/);
assert.match(migration, /event_bus_unrolled_total/);
assert.match(migration, /bad_evidence_rows/);
assert.match(migration, /duplicate_key_rows/);
assert.match(migration, /COLLATE utf8mb4_unicode_ci/);
assert.match(migration, /secrets_included/);
assert.match(migration, /audit_log_event_bus_bridge_tick,audit_event_rollup_builder_tick/);
assert.doesNotMatch(migration, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.doesNotMatch(migration, /before_json|after_json|payload_json|secret_value|token_value/i);

console.log("Dynamic audit pipeline readiness migration guard passed");
