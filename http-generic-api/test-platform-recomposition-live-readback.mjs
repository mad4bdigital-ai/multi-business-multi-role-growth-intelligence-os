import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./scripts/platform-recomposition-live-readback.mjs", import.meta.url), "utf8");

for (const migration of [
  "203_sprint67_execution_log_context_dimensions.sql",
  "204_sprint67_core_runtime_context_dimensions.sql",
  "205_sprint67_runtime_context_dimension_enrichment.sql",
]) {
  assert.ok(source.includes(migration), `${migration} should be included in live readback`);
}

for (const surface of [
  "execution_log",
  "v_core_runtime_context_dimension_coverage",
  "v_runtime_context_dimension_enrichment_fillable",
  "database_table_lifecycle_registry",
  "v_database_lifecycle_status_summary",
  "v_database_lifecycle_report_snapshot_summary",
]) {
  assert.ok(source.includes(surface), `${surface} should be included in live readback`);
}

assert.ok(source.includes("secrets_included: false"));
assert.ok(source.includes("read_only: true"));
assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE)\b\s+/i);

console.log("platform recomposition live readback contract tests passed");
