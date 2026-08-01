import assert from "node:assert/strict";

import {
  GROWTH_CONTROL_LOGICAL_RESOURCE_CATALOG,
  buildGrowthControlAuthorityMap,
} from "./src/domain/growthControlPlane/growthControlAuthorityMap.js";

const logicalNames = GROWTH_CONTROL_LOGICAL_RESOURCE_CATALOG.map((item) => item.logical_resource);
assert.equal(logicalNames.length, 79);
assert.equal(new Set(logicalNames).size, logicalNames.length);
assert.deepEqual([...logicalNames].sort(), logicalNames);

for (const entry of GROWTH_CONTROL_LOGICAL_RESOURCE_CATALOG) {
  assert.match(entry.logical_resource, /^[a-z][a-z0-9_]+$/);
  assert.ok(entry.domain);
  assert.ok(entry.expected_authority);
  assert.ok(Array.isArray(entry.candidate_objects));
  assert.ok(entry.candidate_objects.length > 0);
  assert.ok(Array.isArray(entry.repository_authority_pointers));
  assert.ok(Array.isArray(entry.mandatory_scope_fields));
  assert.ok(entry.mandatory_scope_fields.length > 0);
  assert.equal(typeof entry.revision_required, "boolean");
}

const census = {
  ok: true,
  status: "observed_unclassified",
  mode: "read_only_authority_catalog_census",
  read_only: true,
  applies_sql: false,
  schema_name: "platform",
  objects: [
    { object_name: "tenants", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "growth_control_brand_activity_bindings", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "canonical_capabilities", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "growth_control_compiled_plan_snapshots", object_type: "BASE TABLE", ownership_classification: "evidence_ledger_candidate" },
    { object_name: "approval_holds", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "execution_plans", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "execution_plan_steps", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
    { object_name: "execution_plan_events", object_type: "BASE TABLE", ownership_classification: "evidence_ledger_candidate" },
    { object_name: "v_provider_health_evidence", object_type: "VIEW", ownership_classification: "derived_projection_candidate" },
  ],
  revision_support: [
    { object_name: "tenants", support: "explicit_revision" },
    { object_name: "growth_control_brand_activity_bindings", support: "explicit_revision" },
    { object_name: "canonical_capabilities", support: "temporal_freshness_only" },
    { object_name: "growth_control_compiled_plan_snapshots", support: "explicit_revision" },
    { object_name: "approval_holds", support: "explicit_revision" },
    { object_name: "execution_plans", support: "explicit_revision" },
    { object_name: "execution_plan_steps", support: "explicit_revision" },
    { object_name: "execution_plan_events", support: "absent" },
  ],
  provider_calls: false,
  external_writes: false,
  secrets_included: false,
};

const result = buildGrowthControlAuthorityMap({ census });
assert.equal(result.ok, true);
assert.equal(result.mode, "growth_control_authority_map");
assert.equal(result.schema_name, "platform");
assert.equal(result.logical_resource_count, 79);
assert.equal(result.closure_state.t101_implementation_complete, true);
assert.equal(result.closure_state.t101_complete, false);
assert.equal(result.closure_state.human_authority_classification_required, true);
assert.equal(result.closure_state.live_database_readback_required, true);
assert.equal(result.provider_calls, false);
assert.equal(result.external_writes, false);
assert.equal(result.secrets_included, false);

const byLogical = new Map(result.resources.map((item) => [item.logical_resource, item]));
assert.equal(byLogical.get("tenants").status, "observed_database_authority");
assert.equal(byLogical.get("brand_activity_bindings").status, "observed_database_authority");
assert.equal(byLogical.get("capability_definitions").status, "observed_database_authority");
assert.equal(byLogical.get("compiled_plan_snapshots").status, "observed_database_authority");
assert.equal(byLogical.get("approval_holds").status, "observed_database_authority");
assert.equal(byLogical.get("plans").status, "observed_database_authority");
assert.equal(byLogical.get("workflow_run_transitions").status, "observed_evidence_authority");
assert.equal(byLogical.get("activity_pack_definitions").status, "repository_runtime_authority");
assert.equal(byLogical.get("configuration_definitions").status, "additive_schema_pending");
assert.equal(byLogical.get("feature_flags").status, "unresolved");
assert.equal(byLogical.get("tenants").observed_objects[0].revision_support, "explicit_revision");
assert.equal(byLogical.get("capability_definitions").observed_objects[0].revision_support, "temporal_freshness_only");
assert.equal(byLogical.get("workflow_run_transitions").aliases_grant_authority, false);
assert.ok(result.unresolved_logical_resources.includes("feature_flags"));
assert.ok(result.additive_schema_pending.includes("configuration_definitions"));
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.resources), true);
assert.equal(Object.isFrozen(result.resources[0]), true);
assert.equal(JSON.stringify(result).includes("credential_payload"), false);

assert.throws(
  () => buildGrowthControlAuthorityMap({ census: { ...census, read_only: false } }),
  /read-only census report/,
);
assert.throws(
  () => buildGrowthControlAuthorityMap({ census: { ...census, external_writes: true } }),
  /effects or secrets/,
);
assert.throws(
  () => buildGrowthControlAuthorityMap({ census: { ...census, secrets_included: true } }),
  /effects or secrets/,
);
assert.throws(
  () => buildGrowthControlAuthorityMap({ census: null }),
  /census must be an authority catalog census report/,
);

console.log("growth control authority map tests passed");
