import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaPath = new URL(
  "../specs/011-durable-governed-execution-and-agent-delegation/schemas/phase8-goal-filtered-operational-intelligence.schema.json",
  import.meta.url,
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(
  schema.properties.version.const,
  "spec011-goal-filtered-operational-intelligence-v1",
);
assert.equal(schema.properties.secrets_included.const, false);
assert.match(
  schema.properties.projection_fingerprint_sha256.pattern,
  /64/,
);

for (const state of [
  "not_started",
  "in_progress",
  "attention_required",
  "blocked",
  "completed",
  "unknown",
]) {
  assert(
    schema.properties.goal.properties.state.enum.includes(state),
    `missing goal state ${state}`,
  );
}

for (const classification of [
  "blocking",
  "related_risk",
  "platform_wide",
  "unrelated",
]) {
  assert(
    schema.$defs.classification.enum.includes(classification),
    `missing attention class ${classification}`,
  );
  assert(
    Object.hasOwn(schema.$defs.classCounts.properties, classification),
    `missing attention count ${classification}`,
  );
}

for (const required of [
  "total_operations",
  "linked_operations",
  "primary_operations",
  "supporting_operations",
  "unrelated_operations",
  "attention_total",
  "attention_by_class",
  "full_diagnostic_operation_count",
  "full_diagnostic_attention_count",
]) {
  assert(
    schema.properties.summary.required.includes(required),
    `missing summary field ${required}`,
  );
}

assert.equal(schema.properties.completeness.properties.summary_first.const, true);
assert.equal(
  schema.properties.completeness.properties.full_diagnostic_detail_inline.const,
  false,
);
assert.equal(
  schema.properties.completeness.properties.unrelated_items_counted_not_discarded.const,
  true,
);

for (const policy of [
  "exact_correlation_only",
  "tenant_only_match_is_insufficient",
  "unrelated_attention_not_inlined",
  "full_diagnostics_preserved_by_governed_reference",
  "response_is_read_only",
]) {
  assert.equal(
    schema.properties.policy.properties[policy].const,
    true,
    `policy ${policy} must be true`,
  );
}
assert.equal(schema.properties.policy.properties.provider_calls_made.const, false);
assert.equal(
  schema.properties.policy.properties.external_mutations_executed.const,
  false,
);
assert.equal(schema.properties.policy.properties.secrets_included.const, false);

for (const field of [
  "reference",
  "read_tool_key",
  "digest_sha256",
  "item_id",
  "kind",
  "secrets_included",
]) {
  assert(
    schema.$defs.diagnosticReference.required.includes(field),
    `missing diagnostic reference field ${field}`,
  );
}
assert.deepEqual(
  [...schema.$defs.diagnosticReference.properties.kind.enum].sort(),
  ["attention", "operation"],
);
assert.equal(
  schema.$defs.diagnosticReference.properties.secrets_included.const,
  false,
);

for (const bucket of ["blocking", "related_risk", "platform_wide"]) {
  assert(
    schema.properties.attention.required.includes(bucket),
    `missing inline attention bucket ${bucket}`,
  );
}
assert.equal(
  Object.hasOwn(schema.properties.attention.properties, "unrelated"),
  false,
  "unrelated attention must not be inlined",
);

for (const referenceBucket of [
  "operations",
  "attention",
  "unrelated_attention",
  "unrelated_operations",
]) {
  assert(
    schema.properties.detail_references.required.includes(referenceBucket),
    `missing diagnostic bucket ${referenceBucket}`,
  );
}

console.log("Spec 011 goal-filtered operational intelligence schema tests passed");
