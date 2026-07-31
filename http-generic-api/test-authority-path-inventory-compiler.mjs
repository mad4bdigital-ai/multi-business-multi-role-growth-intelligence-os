import assert from "node:assert/strict";

import {
  AuthorityPathInventoryError,
  compileAuthorityPathInventory,
} from "./authorityPathInventoryCompiler.js";

function basePath(overrides = {}) {
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
    aliases: ["admin.connector.inventory"],
    requirements: {
      approval: false,
      typed_confirmation: false,
      capability_envelope: false,
      idempotency: false,
      readback: false,
      rollback: false,
    },
    secrets_included: false,
    credential_payload_read: false,
    ...overrides,
  };
}

const report = compileAuthorityPathInventory({
  expected_source_keys: ["admin_endpoint_catalog", "system_tool_registry"],
  source_snapshots: [
    {
      source_key: "admin_endpoint_catalog",
      source_identity: "admin_endpoint_catalog.snapshot-1",
      observed_at: "2030-01-01T00:00:00Z",
      complete: true,
      paths: [basePath()],
      secrets_included: false,
    },
    {
      source_key: "system_tool_registry",
      source_identity: "system_tool_registry.snapshot-1",
      observed_at: "2030-01-01T00:00:01Z",
      complete: true,
      paths: [basePath({ source_registry: "system_tool_registry" })],
      secrets_included: false,
    },
  ],
});

assert.equal(report.contract, "mad4b.ueacp.authority-path-inventory.v1");
assert.equal(report.status, "ready_for_human_closure_review");
assert.equal(report.summary.source_count, 2);
assert.equal(report.summary.observed_path_row_count, 2);
assert.equal(report.summary.canonical_path_count, 1);
assert.equal(report.summary.shared_count, 1);
assert.equal(report.summary.blocking_gap_count, 0);
assert.deepEqual(report.paths[0].source_keys, ["admin_endpoint_catalog", "system_tool_registry"]);
assert.deepEqual(report.paths[0].source_registries, ["admin_endpoint_catalog", "system_tool_registry"]);
assert.equal(report.closure_state.t001_complete, false);
assert.equal(report.closure_state.t001_ready_for_human_review, true);
assert.equal(report.provider_calls, false);
assert.equal(report.credential_payload_read, false);
assert.equal(report.external_writes, false);
assert.equal(report.secrets_included, false);
assert.match(report.inventory_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(report), true);
assert.equal(Object.isFrozen(report.paths), true);
assert.equal(Object.isFrozen(report.paths[0]), true);

const incomplete = compileAuthorityPathInventory({
  expected_source_keys: ["admin_endpoint_catalog", "direct_http_routes"],
  source_snapshots: [
    {
      source_key: "admin_endpoint_catalog",
      source_identity: "admin_endpoint_catalog.snapshot-2",
      observed_at: "2030-01-01T00:00:00Z",
      complete: false,
      paths: [basePath({ revision_source: null })],
    },
  ],
});
assert.equal(incomplete.status, "incomplete");
assert.equal(incomplete.closure_state.t001_ready_for_human_review, false);
assert.ok(incomplete.gaps.some((gap) => gap.code === "missing_expected_source"));
assert.ok(incomplete.gaps.some((gap) => gap.code === "source_snapshot_incomplete"));
assert.ok(incomplete.gaps.some((gap) => gap.code === "path_classification_incomplete"));

const conflict = compileAuthorityPathInventory({
  source_snapshots: [
    {
      source_key: "source_a",
      source_identity: "source_a.snapshot",
      observed_at: "2030-01-01T00:00:00Z",
      complete: true,
      paths: [basePath({ source_registry: "registry_a" })],
    },
    {
      source_key: "source_b",
      source_identity: "source_b.snapshot",
      observed_at: "2030-01-01T00:00:00Z",
      complete: true,
      paths: [basePath({ source_registry: "registry_b", risk_class: "high" })],
    },
  ],
});
assert.ok(conflict.gaps.some((gap) => gap.code === "conflicting_path_contract"));
assert.equal(conflict.closure_state.t001_ready_for_human_review, false);

const mutation = compileAuthorityPathInventory({
  source_snapshots: [
    {
      source_key: "mutation_registry",
      source_identity: "mutation_registry.snapshot",
      observed_at: "2030-01-01T00:00:00Z",
      complete: true,
      paths: [basePath({
        path_key: "authority.binding.apply",
        route: "/authority/bindings",
        method: "POST",
        authority_mode: "admin_only",
        operation_mode: "mutation",
        requirements: {
          approval: true,
          typed_confirmation: true,
          capability_envelope: true,
          idempotency: false,
          readback: true,
          rollback: false,
        },
      })],
    },
  ],
});
const mutationGap = mutation.gaps.find((gap) => gap.path_key === "authority.binding.apply");
assert.deepEqual(mutationGap.missing_fields, ["requirements.idempotency", "requirements.rollback"]);

assert.throws(
  () => compileAuthorityPathInventory({
    source_snapshots: [{
      source_key: "unsafe",
      source_identity: "unsafe.snapshot",
      observed_at: "2030-01-01T00:00:00Z",
      complete: true,
      paths: [{ ...basePath(), access_token: "forbidden" }],
    }],
  }),
  (error) => error instanceof AuthorityPathInventoryError
    && error.code === "authority_path_secret_field_forbidden",
);

assert.throws(
  () => compileAuthorityPathInventory({
    source_snapshots: [
      { source_key: "duplicate", source_identity: "duplicate.a", observed_at: "2030-01-01T00:00:00Z", complete: true, paths: [] },
      { source_key: "duplicate", source_identity: "duplicate.b", observed_at: "2030-01-01T00:00:01Z", complete: true, paths: [] },
    ],
  }),
  (error) => error instanceof AuthorityPathInventoryError
    && error.code === "authority_path_duplicate_source",
);

assert.throws(
  () => compileAuthorityPathInventory({ source_snapshots: [], limits: { maxSources: 0 } }),
  (error) => error instanceof AuthorityPathInventoryError
    && error.code === "authority_path_invalid_limit",
);

assert.throws(
  () => compileAuthorityPathInventory({ source_snapshots: "not-array" }),
  (error) => error instanceof AuthorityPathInventoryError
    && error.code === "authority_path_invalid_sources",
);

console.log("authority path inventory compiler tests passed");
