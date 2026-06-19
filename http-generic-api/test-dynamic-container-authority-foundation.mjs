import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CONTAINER_RESOLUTION_LIMITS,
  detectContainmentCycle,
  resolveContainerDimensionCandidates,
  stableSerialize,
  validateContainerRelationship,
  validateNoSecretMetadata
} from "./dynamicContainerAuthority.js";

const migration = readFileSync("migrations/319_sprint69_dynamic_container_authority_foundation.sql", "utf8");

for (const table of [
  "container_type_registry",
  "containers",
  "container_relationship_type_registry",
  "container_relationships",
  "container_closure",
  "container_classification_type_registry",
  "container_classifications",
  "container_role_template_registry",
  "container_role_template_permissions",
  "container_role_assignments",
  "container_resource_dimension_registry",
  "container_resource_bindings",
  "container_authority_epochs"
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS \\`${table}\\``), `${table} must be additive`);
}
assert.match(migration, /v_container_active_hierarchy/);
assert.match(migration, /v_container_relationship_issues/);
assert.match(migration, /v_container_authority_foundation_summary/);
assert.match(migration, /'platform','Platform'/);
assert.match(migration, /'tenant','Tenant'/);
assert.match(migration, /'workspace','Workspace'/);
assert.match(migration, /'brand','Brand'/);
assert.match(migration, /'activity','Activity'/);
assert.match(migration, /'workflow','Workflow'/);
assert.match(migration, /'shares','Shares','sharing'.*'read_only'/s);
assert.match(migration, /'delegates','Delegates','delegation'.*'delegated_write'/s);
assert.match(migration, /'credentials','Credentials'.*'binding_references_only',true/s);
assert.match(migration, /runtime_enforcement_enabled/);
assert.match(migration, /provider_calls_enabled/);
assert.match(migration, /credential_payload_reads_enabled/);
assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);

const containerTypes = [
  { container_type_key: "workspace", status: "active", supports_multi_parent: 1, allowed_parent_types_json: '["tenant"]', allowed_child_types_json: '["brand","activity"]' },
  { container_type_key: "brand", status: "active", supports_multi_parent: 1, allowed_parent_types_json: '["workspace"]', allowed_child_types_json: '["activity"]' },
  { container_type_key: "activity", status: "active", supports_multi_parent: 1, allowed_parent_types_json: '["workspace","brand","activity"]', allowed_child_types_json: '["activity"]' },
  { container_type_key: "single", status: "active", supports_multi_parent: 0, allowed_parent_types_json: '["workspace"]', allowed_child_types_json: '[]' }
];
const relationshipTypes = [
  { relationship_type_key: "contains", relationship_class: "containment", contributes_to_ancestry: 1, status: "active" },
  { relationship_type_key: "shares", relationship_class: "sharing", contributes_to_ancestry: 0, status: "active" }
];
const containers = [
  { container_id: "w1", tenant_id: "t1", container_type_key: "workspace", status: "active" },
  { container_id: "w2", tenant_id: "t1", container_type_key: "workspace", status: "active" },
  { container_id: "b1", tenant_id: "t1", container_type_key: "brand", status: "active" },
  { container_id: "a1", tenant_id: "t1", container_type_key: "activity", status: "active" },
  { container_id: "s1", tenant_id: "t1", container_type_key: "single", status: "active" },
  { container_id: "foreign", tenant_id: "t2", container_type_key: "brand", status: "active" }
];

const firstBrandParent = { relationship_id: "r1", tenant_id: "t1", from_container_id: "w1", to_container_id: "b1", relationship_type_key: "contains", status: "active" };
assert.equal(validateContainerRelationship({ relationship: firstBrandParent, containers, containerTypes, relationshipTypes }).ok, true);
assert.equal(validateContainerRelationship({
  relationship: { ...firstBrandParent, relationship_id: "r2", from_container_id: "w2" },
  relationships: [firstBrandParent], containers, containerTypes, relationshipTypes
}).ok, true, "multi-parent brand containment must be allowed");

const singleParent = { relationship_id: "single-1", tenant_id: "t1", from_container_id: "w1", to_container_id: "s1", relationship_type_key: "contains", status: "active" };
const secondSingleParent = validateContainerRelationship({
  relationship: { ...singleParent, relationship_id: "single-2", from_container_id: "w2" },
  relationships: [singleParent], containers, containerTypes, relationshipTypes
});
assert.equal(secondSingleParent.ok, false);
assert(secondSingleParent.errors.some(error => error.code === "container_multiple_parents_not_allowed"));

const crossTenant = validateContainerRelationship({
  relationship: { relationship_id: "cross", tenant_id: "t1", from_container_id: "w1", to_container_id: "foreign", relationship_type_key: "contains", status: "active" },
  containers, containerTypes, relationshipTypes
});
assert.equal(crossTenant.ok, false);
assert(crossTenant.errors.some(error => error.code === "container_cross_tenant_boundary"));

const graph = [
  { relationship_id: "g1", from_container_id: "w1", to_container_id: "b1", relationship_type_key: "contains", status: "active" },
  { relationship_id: "g2", from_container_id: "b1", to_container_id: "a1", relationship_type_key: "contains", status: "active" }
];
const cycle = detectContainmentCycle({
  relationships: graph,
  proposedRelationship: { from_container_id: "a1", to_container_id: "w1", relationship_type_key: "contains" },
  relationshipTypes
});
assert.equal(cycle.hasCycle, true);
assert.equal(cycle.code, "container_cycle_detected");
assert.deepEqual(cycle.path, ["a1", "w1", "b1", "a1"]);

const noCycle = detectContainmentCycle({
  relationships: graph,
  proposedRelationship: { from_container_id: "w2", to_container_id: "a1", relationship_type_key: "contains" },
  relationshipTypes
});
assert.equal(noCycle.hasCycle, false);
assert.equal(noCycle.blocked, false);

const limitFailure = detectContainmentCycle({
  relationships: graph,
  proposedRelationship: { from_container_id: "w2", to_container_id: "w1", relationship_type_key: "contains" },
  relationshipTypes,
  limits: { ...DEFAULT_CONTAINER_RESOLUTION_LIMITS, maxTraversedRelationships: 1 }
});
assert.equal(limitFailure.blocked, true);
assert.equal(limitFailure.code, "container_resolution_limit_exceeded");

const deny = resolveContainerDimensionCandidates([
  { sourceId: "allow", effect: "allow", depth: 1, priority: 10 },
  { sourceId: "deny", effect: "deny", depth: 4, priority: 0 }
], "deny_wins");
assert.equal(deny.blocked, true);
assert.equal(deny.decision, "deny");

assert.deepEqual(resolveContainerDimensionCandidates([
  { sourceId: "one", value: ["b", "a"] },
  { sourceId: "two", value: ["b", "c"] }
], "union").value, ["a", "b", "c"]);
assert.deepEqual(resolveContainerDimensionCandidates([
  { sourceId: "one", value: ["a", "b"] },
  { sourceId: "two", value: ["b", "c"] }
], "intersection").value, ["b"]);
assert.equal(resolveContainerDimensionCandidates([
  { sourceId: "workspace", value: 100 },
  { sourceId: "brand", value: 30 }
], "minimum").value, 30);

const nearest = resolveContainerDimensionCandidates([
  { sourceId: "workspace", value: "profile-a", depth: 2, priority: 0 },
  { sourceId: "brand", value: "profile-b", depth: 1, priority: 0 }
], "nearest_replace");
assert.equal(nearest.value, "profile-b");

const ambiguous = resolveContainerDimensionCandidates([
  { sourceId: "path-a", value: { profile: "a" }, depth: 1, priority: 5 },
  { sourceId: "path-b", value: { profile: "b" }, depth: 1, priority: 5 }
], "nearest_replace");
assert.equal(ambiguous.blocked, true);
assert.equal(ambiguous.code, "container_path_ambiguous");
assert.equal(stableSerialize({ b: 2, a: 1 }), stableSerialize({ a: 1, b: 2 }));

assert.equal(validateNoSecretMetadata({ display_name: "safe", nested: { source_ref: "ref-1" } }).ok, true);
const unsafeMetadata = validateNoSecretMetadata({ nested: { access_token: "forbidden" } });
assert.equal(unsafeMetadata.ok, false);
assert.equal(unsafeMetadata.violations[0].code, "container_secret_field_forbidden");

console.log("dynamic container authority foundation tests passed");
