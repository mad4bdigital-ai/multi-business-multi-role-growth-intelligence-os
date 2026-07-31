import assert from "node:assert/strict";

import { compileAuthorityPathInventory } from "./authorityPathInventoryCompiler.js";
import {
  AuthorityDataFoundationPlanError,
  buildAuthorityDataFoundationPlan,
} from "./authorityDataFoundationPlanner.js";

function pathRecord() {
  return {
    path_key: "authority.connector.inventory.read",
    canonical_tool_key: "connector_inventory_read",
    route: "/authority/connectors",
    method: "GET",
    surface_family: "connector_inventory",
    source_registry: "admin_endpoint_catalog",
    handler_key: "getConnectorInventory",
    authority_mode: "shared",
    operation_mode: "read_only",
    callability: "callable",
    status: "active",
    actor_source: "authenticated_principal",
    subject_source: "effective_subject_scope",
    tenant_scope_source: "principal_tenant_scope",
    workspace_scope_source: "principal_workspace_scope",
    resource_authority_source: "resource_authority_bindings",
    capability_authority_source: "platform_semantic_capabilities",
    provider_scope_source: "selected_provider_binding",
    credential_scope_source: "credential_reference_metadata",
    risk_class: "low",
    revision_source: "platform_semantic_capabilities",
    freshness_source: "platform_semantic_capabilities.updated_at",
    revocation_source: "platform_semantic_capabilities.status",
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: "read_only_snapshot",
    aliases: [],
    requirements: {},
  };
}

const inventory = compileAuthorityPathInventory({
  expected_source_keys: ["admin_endpoint_catalog"],
  source_snapshots: [{
    source_key: "admin_endpoint_catalog",
    source_identity: "admin_endpoint_catalog.snapshot",
    observed_at: "2030-01-01T00:00:00Z",
    complete: true,
    paths: [pathRecord()],
  }],
});

function catalog({ exact = false, t002Complete = false } = {}) {
  const storageObjects = exact
    ? [
      "resource_nodes",
      "resource_edges",
      "resource_access_grants",
      "resource_restrictions",
      "delegation_contexts",
      "effective_authority_decisions",
      "authority_decision_evidence",
      "authority_projection_snapshots",
      "authority_projection_items",
      "authority_drift_findings",
      "authority_invalidation_events",
    ]
    : [
      "resource_nodes",
      "delegation_grants",
      "effective_authority_shadow_decisions",
      "authority_projection_drift_events",
    ];
  const objects = ["platform_semantic_capabilities", ...storageObjects].map((objectName) => ({
    object_name: objectName,
    object_type: "BASE TABLE",
    ownership_classification: objectName.includes("decision") || objectName.includes("drift")
      ? "evidence_ledger_candidate"
      : "authority_source_candidate",
  }));
  return {
    ok: true,
    mode: "read_only_authority_catalog_census",
    read_only: true,
    applies_sql: false,
    schema_name: "platform",
    database_server: { observed_at: "2030-01-01T00:00:00Z" },
    summary: { object_count: objects.length },
    objects,
    revision_support: objects.map((object) => ({
      object_name: object.object_name,
      ownership_classification: object.ownership_classification,
      support: "explicit_revision",
      explicit_revision_columns: ["revision"],
      temporal_freshness_columns: ["updated_at"],
      requires_authoritative_owner_review: true,
    })),
    closure_state: { t002_complete: t002Complete },
    external_writes: false,
    secrets_included: false,
  };
}

const blocked = buildAuthorityDataFoundationPlan({
  catalog_census: catalog(),
  path_inventory: inventory,
});

assert.equal(blocked.contract, "mad4b.ueacp.authority-data-foundation-plan.v1");
assert.equal(blocked.status, "blocked_pending_evidence");
assert.ok(blocked.blocking_issues.includes("t001_authority_path_inventory_not_closed"));
assert.ok(blocked.blocking_issues.includes("t002_live_catalog_not_closed"));
assert.ok(blocked.blocking_issues.includes("t023_alias_contract_review_required"));
assert.ok(blocked.blocking_issues.includes("t024_alias_contract_review_required"));
assert.equal(blocked.storage_task_plans.T022.exact_reuse_count, 1);
assert.equal(blocked.storage_task_plans.T022.additive_create_candidate_count, 3);
assert.equal(blocked.storage_task_plans.T023.alias_review_count, 1);
assert.equal(blocked.storage_task_plans.T024.alias_review_count, 2);
assert.equal(blocked.closure_state.migration_execution_authorized, false);
assert.equal(blocked.runtime_enforcement_enabled, false);
assert.equal(blocked.evidence_persistence_enabled, false);
assert.equal(blocked.provider_calls, false);
assert.equal(blocked.credential_payload_read, false);
assert.equal(blocked.external_writes, false);
assert.equal(blocked.secrets_included, false);
assert.match(blocked.plan_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(blocked), true);

const reviewedInventory = {
  ...inventory,
  closure_state: {
    ...inventory.closure_state,
    t001_complete: true,
    t001_ready_for_human_review: true,
  },
};
const ready = buildAuthorityDataFoundationPlan({
  catalog_census: catalog({ exact: true, t002Complete: true }),
  path_inventory: reviewedInventory,
});
assert.equal(ready.status, "ready_for_migration_design_review");
assert.deepEqual(ready.blocking_issues, []);
assert.equal(ready.revision_plan.unresolved_reference_count, 0);
assert.equal(ready.storage_task_plans.T022.exact_reuse_count, 4);
assert.equal(ready.storage_task_plans.T023.exact_reuse_count, 1);
assert.equal(ready.storage_task_plans.T024.exact_reuse_count, 6);
assert.equal(ready.closure_state.migration_design_ready_for_human_review, true);
assert.equal(ready.closure_state.migration_execution_authorized, false);
assert.deepEqual(ready.migration_batches.map((batch) => batch.tasks), [
  ["T021"],
  ["T022", "T023"],
  ["T024"],
]);

assert.throws(
  () => buildAuthorityDataFoundationPlan({
    catalog_census: { ...catalog(), access_token: "forbidden" },
    path_inventory: inventory,
  }),
  (error) => error instanceof AuthorityDataFoundationPlanError
    && error.code === "authority_data_secret_field_forbidden",
);

assert.throws(
  () => buildAuthorityDataFoundationPlan({
    catalog_census: { ...catalog(), mode: "mutable_catalog" },
    path_inventory: inventory,
  }),
  (error) => error instanceof AuthorityDataFoundationPlanError
    && error.code === "authority_data_untrusted_catalog",
);

console.log("authority data foundation planner tests passed");
