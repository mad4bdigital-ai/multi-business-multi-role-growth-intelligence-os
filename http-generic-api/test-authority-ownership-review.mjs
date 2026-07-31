import assert from "node:assert/strict";

import { buildAuthorityEvidenceSourceBundle } from "./authorityEvidenceSourceAdapters.js";
import {
  AuthorityOwnershipReviewError,
  assessAuthorityOwnershipReview,
} from "./authorityOwnershipReview.js";

function pathRecord() {
  return {
    path_key: "authority.connector.inventory.read",
    canonical_tool_key: "connector_inventory_read",
    route: "/authority/connectors",
    method: "GET",
    surface_family: "connector_inventory",
    source_registry: "system_tool_registry",
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
    revocation_source: "platform_semantic_capabilities",
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: "read_only_snapshot",
    aliases: [],
    requirements: {},
    credential_payload_read: false,
    secrets_included: false,
  };
}

function sourceBundle() {
  return buildAuthorityEvidenceSourceBundle({
    expected_source_families: ["system_tool_registry"],
    sources: [{
      source_family: "system_tool_registry",
      source_key: "system_tool_registry.snapshot",
      source_identity: "system_tool_registry.snapshot-2030-01-01",
      observed_at: "2030-01-01T00:00:00Z",
      pagination: {
        expected_count: 1,
        observed_count: 1,
        page_count: 1,
        complete: true,
        next_cursor: null,
      },
      evidence_refs: ["run:system-tools-1"],
      records: [pathRecord()],
      safety: {
        read_only: true,
        provider_calls: false,
        credential_payload_read: false,
        external_writes: false,
        secrets_included: false,
      },
    }],
  });
}

function catalog() {
  return {
    ok: true,
    status: "observed_unclassified",
    mode: "read_only_authority_catalog_census",
    read_only: true,
    applies_sql: false,
    schema_name: "platform",
    database_server: {
      version: "11.4.2-MariaDB",
      version_comment: "MariaDB Server",
      observed_at: "2030-01-01T00:00:00Z",
    },
    objects: [
      { object_name: "platform_semantic_capabilities", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "resource_authority_bindings", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "authority_invalidation_events", object_type: "BASE TABLE", ownership_classification: "evidence_ledger_candidate" },
      { object_name: "v_effective_capabilities", object_type: "VIEW", ownership_classification: "derived_projection_candidate" },
    ],
    revision_support: [
      { object_name: "platform_semantic_capabilities", support: "explicit_revision", explicit_revision_columns: ["revision"], temporal_freshness_columns: ["updated_at"], requires_authoritative_owner_review: true },
      { object_name: "resource_authority_bindings", support: "temporal_freshness_only", explicit_revision_columns: [], temporal_freshness_columns: ["updated_at"], requires_authoritative_owner_review: true },
      { object_name: "authority_invalidation_events", support: "explicit_revision", explicit_revision_columns: ["event_revision"], temporal_freshness_columns: [], requires_authoritative_owner_review: true },
    ],
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
}

function reviewEntries() {
  return [
    {
      object_name: "platform_semantic_capabilities",
      ownership_class: "source_authority",
      owner_key: "context_kernel",
      approved: true,
      revision_strategy: "reuse_explicit_revision",
      evidence_refs: ["catalog:platform_semantic_capabilities", "path:authority.connector.inventory.read"],
      rationale: "This table is the canonical semantic capability authority and already exposes an explicit revision contract.",
    },
    {
      object_name: "resource_authority_bindings",
      ownership_class: "source_authority",
      owner_key: "resource_authority",
      approved: true,
      revision_strategy: "add_explicit_revision",
      evidence_refs: ["catalog:resource_authority_bindings", "path:authority.connector.inventory.read"],
      rationale: "This table owns resource bindings but currently exposes temporal freshness only, so an explicit revision is required.",
    },
    {
      object_name: "authority_invalidation_events",
      ownership_class: "evidence_ledger",
      owner_key: "context_kernel",
      approved: true,
      revision_strategy: "reuse_explicit_revision",
      evidence_refs: ["catalog:authority_invalidation_events"],
      rationale: "This append-only ledger records invalidation evidence and already exposes a stable event revision for ordering.",
    },
    {
      object_name: "v_effective_capabilities",
      ownership_class: "derived_projection",
      owner_key: "context_kernel",
      approved: true,
      revision_strategy: "not_applicable",
      evidence_refs: ["catalog:v_effective_capabilities"],
      rationale: "This view is a derived projection and must never become an authority source or receive an independent revision contract.",
    },
  ];
}

function metadata(overrides = {}) {
  return {
    reviewer_key: "platform_architecture_review",
    reviewed_at: "2030-01-01T00:10:00Z",
    evidence_context: {
      environment: "production_read_only",
      operation_ref: "operation:ueacp-census-1",
      readback_ref: "readback:ueacp-census-1",
      live_observation: true,
      same_cycle_readback: true,
    },
    ...overrides,
  };
}

const bundle = sourceBundle();
const report = assessAuthorityOwnershipReview({
  catalog_census: catalog(),
  source_bundle: bundle,
  review_entries: reviewEntries(),
  review_metadata: metadata(),
});

assert.equal(report.contract, "mad4b.ueacp.authority-ownership-review.v1");
assert.equal(report.status, "ready_for_human_task_closure_review");
assert.deepEqual(report.gaps.blocking_issues, []);
assert.equal(report.required_object_names.length, 4);
assert.equal(report.reviewed_object_count, 4);
assert.equal(report.closure_state.t001_complete, false);
assert.equal(report.closure_state.t002_complete, false);
assert.equal(report.closure_state.t001_ready_for_human_closure, true);
assert.equal(report.closure_state.t002_ready_for_human_closure, true);
assert.equal(report.closure_state.migration_design_input_ready, true);
assert.equal(report.closure_state.migration_apply_authorized, false);
assert.equal(report.read_only, true);
assert.equal(report.applies_sql, false);
assert.equal(report.runtime_authority_changed, false);
assert.equal(report.provider_calls, false);
assert.equal(report.credential_payload_read, false);
assert.equal(report.external_writes, false);
assert.equal(report.secrets_included, false);
assert.match(report.bindings.catalog_sha256, /^[a-f0-9]{64}$/);
assert.match(report.bindings.source_bundle_sha256, /^[a-f0-9]{64}$/);
assert.match(report.bindings.inventory_sha256, /^[a-f0-9]{64}$/);
assert.match(report.review_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(report), true);

const notLive = assessAuthorityOwnershipReview({
  catalog_census: catalog(),
  source_bundle: bundle,
  review_entries: reviewEntries(),
  review_metadata: metadata({
    evidence_context: {
      ...metadata().evidence_context,
      live_observation: false,
      same_cycle_readback: false,
    },
  }),
});
assert.equal(notLive.status, "blocked");
assert.ok(notLive.gaps.blocking_issues.includes("catalog_not_live_observation"));
assert.ok(notLive.gaps.blocking_issues.includes("same_cycle_readback_missing"));

const missingReview = assessAuthorityOwnershipReview({
  catalog_census: catalog(),
  source_bundle: bundle,
  review_entries: reviewEntries().slice(0, 2),
  review_metadata: metadata(),
});
assert.equal(missingReview.status, "blocked");
assert.ok(missingReview.gaps.blocking_issues.includes("required_objects_unreviewed"));
assert.deepEqual(missingReview.gaps.missing_objects, ["authority_invalidation_events", "v_effective_capabilities"]);

const revisionMismatchEntries = reviewEntries().map((entry) => (
  entry.object_name === "resource_authority_bindings"
    ? { ...entry, revision_strategy: "reuse_explicit_revision" }
    : entry
));
const revisionMismatch = assessAuthorityOwnershipReview({
  catalog_census: catalog(),
  source_bundle: bundle,
  review_entries: revisionMismatchEntries,
  review_metadata: metadata(),
});
assert.ok(revisionMismatch.gaps.blocking_issues.includes("revision_strategy_mismatch"));
assert.deepEqual(revisionMismatch.gaps.revision_mismatches, ["resource_authority_bindings"]);

const invalidSharingEntries = reviewEntries().map((entry) => (
  entry.object_name === "platform_semantic_capabilities"
    ? { ...entry, ownership_class: "shared_authority", shared_owner_keys: ["other_owner"] }
    : entry
));
const invalidSharing = assessAuthorityOwnershipReview({
  catalog_census: catalog(),
  source_bundle: bundle,
  review_entries: invalidSharingEntries,
  review_metadata: metadata(),
});
assert.ok(invalidSharing.gaps.blocking_issues.includes("shared_ownership_contract_invalid"));

assert.throws(
  () => assessAuthorityOwnershipReview({
    catalog_census: { ...catalog(), access_token: "forbidden" },
    source_bundle: bundle,
    review_entries: reviewEntries(),
    review_metadata: metadata(),
  }),
  (error) => error instanceof AuthorityOwnershipReviewError
    && error.code === "authority_ownership_secret_value_forbidden",
);

assert.throws(
  () => assessAuthorityOwnershipReview({
    catalog_census: catalog(),
    source_bundle: bundle,
    review_entries: [...reviewEntries(), reviewEntries()[0]],
    review_metadata: metadata(),
  }),
  (error) => error instanceof AuthorityOwnershipReviewError
    && error.code === "authority_ownership_duplicate_entry",
);

console.log("authority ownership review tests passed");
