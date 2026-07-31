import assert from "node:assert/strict";

import {
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  AuthorityEvidenceSourceError,
  buildAuthorityEvidenceSourceBundle,
} from "./authorityEvidenceSourceAdapters.js";

function pathRecord(sourceRegistry) {
  return {
    path_key: "authority.connector.inventory.read",
    canonical_tool_key: "connector_inventory_read",
    route: "/authority/connectors",
    method: "GET",
    surface_family: "connector_inventory",
    source_registry: sourceRegistry,
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
    credential_payload_read: false,
    secrets_included: false,
  };
}

function source(family, overrides = {}) {
  const records = overrides.records ?? [pathRecord(family)];
  return {
    source_family: family,
    source_key: `${family}.snapshot`,
    source_identity: `${family}.snapshot-2030-01-01`,
    observed_at: "2030-01-01T00:00:00Z",
    pagination: {
      expected_count: records.length,
      observed_count: records.length,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`run:${family}.1`],
    records,
    safety: {
      read_only: true,
      provider_calls: false,
      credential_payload_read: false,
      external_writes: false,
      secrets_included: false,
    },
    ...overrides,
  };
}

const expectedFamilies = ["system_tool_registry", "admin_endpoint_catalog"];
const bundle = buildAuthorityEvidenceSourceBundle({
  expected_source_families: expectedFamilies,
  sources: expectedFamilies.map((family) => source(family)),
});

assert.equal(bundle.contract, "mad4b.ueacp.authority-evidence-source-bundle.v1");
assert.equal(bundle.status, "ready_for_ownership_review");
assert.equal(bundle.source_family_count, 2);
assert.equal(bundle.blocking_gap_count, 0);
assert.equal(bundle.inventory.status, "ready_for_human_closure_review");
assert.equal(bundle.inventory.summary.canonical_path_count, 1);
assert.deepEqual(bundle.inventory.paths[0].source_registries, expectedFamilies.slice().sort());
assert.equal(bundle.closure_state.t001_complete, false);
assert.equal(bundle.closure_state.source_evidence_ready_for_human_review, true);
assert.equal(bundle.read_only, true);
assert.equal(bundle.provider_calls, false);
assert.equal(bundle.credential_payload_read, false);
assert.equal(bundle.external_writes, false);
assert.equal(bundle.secrets_included, false);
assert.match(bundle.bundle_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(bundle), true);
assert.equal(Object.isFrozen(bundle.sources), true);

const incomplete = buildAuthorityEvidenceSourceBundle({
  expected_source_families: expectedFamilies,
  sources: [source("system_tool_registry", {
    pagination: {
      expected_count: 2,
      observed_count: 1,
      page_count: 1,
      complete: false,
      next_cursor: "page-2",
    },
  })],
});
assert.equal(incomplete.status, "incomplete");
assert.ok(incomplete.gaps.some((gap) => gap.code === "missing_source_family"));
assert.ok(incomplete.gaps.some((gap) => gap.code === "incomplete_source_family"));
assert.equal(incomplete.closure_state.source_evidence_ready_for_human_review, false);

const conflictingRecords = [
  source("system_tool_registry"),
  source("admin_endpoint_catalog", {
    records: [pathRecord("admin_endpoint_catalog")].map((record) => ({ ...record, risk_class: "high" })),
  }),
];
const conflicting = buildAuthorityEvidenceSourceBundle({
  expected_source_families: expectedFamilies,
  sources: conflictingRecords,
});
assert.equal(conflicting.status, "incomplete");
assert.ok(conflicting.gaps.some((gap) => gap.code === "conflicting_path_contract"));

assert.throws(
  () => buildAuthorityEvidenceSourceBundle({
    expected_source_families: ["system_tool_registry"],
    sources: [source("system_tool_registry", {
      safety: {
        read_only: true,
        provider_calls: true,
        credential_payload_read: false,
        external_writes: false,
        secrets_included: false,
      },
    })],
  }),
  (error) => error instanceof AuthorityEvidenceSourceError
    && error.code === "authority_evidence_unsafe_source",
);

assert.throws(
  () => buildAuthorityEvidenceSourceBundle({
    expected_source_families: ["system_tool_registry"],
    sources: [source("system_tool_registry", {
      records: [{ ...pathRecord("system_tool_registry"), access_token: "forbidden" }],
    })],
  }),
  (error) => error instanceof AuthorityEvidenceSourceError
    && error.code === "authority_evidence_secret_value_forbidden",
);

assert.throws(
  () => buildAuthorityEvidenceSourceBundle({
    expected_source_families: ["unknown_family"],
    sources: [],
  }),
  (error) => error instanceof AuthorityEvidenceSourceError
    && error.code === "authority_evidence_unknown_source_family",
);

assert.throws(
  () => buildAuthorityEvidenceSourceBundle({
    expected_source_families: ["system_tool_registry"],
    sources: [source("system_tool_registry"), source("system_tool_registry", { source_key: "other.snapshot" })],
  }),
  (error) => error instanceof AuthorityEvidenceSourceError
    && error.code === "authority_evidence_duplicate_source_family",
);

assert.deepEqual(AUTHORITY_EVIDENCE_SOURCE_FAMILIES, [
  "system_tool_registry",
  "admin_endpoint_catalog",
  "direct_http_routes",
  "runtime_action_registry",
  "descriptor_catalog",
  "provider_binding_catalog",
  "local_device_catalog",
  "compatibility_alias_registry",
]);

console.log("authority evidence source adapter tests passed");
