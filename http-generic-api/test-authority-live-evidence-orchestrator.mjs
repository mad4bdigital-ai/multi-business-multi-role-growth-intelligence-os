import assert from "node:assert/strict";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";
import {
  collectGovernedAuthorityLiveEvidence,
  finalizeGovernedAuthorityLiveEvidence,
} from "./authorityLiveEvidenceOrchestrator.js";

function authorization(overrides = {}) {
  return {
    contract: "mad4b.ueacp.authority-live-evidence-authorization.v1",
    operation_mode: "read_only_live_authority_evidence",
    operation_ref: "operation:ueacp-live-evidence-1",
    environment: "production_read_only",
    target_schema: "platform",
    issued_at: "2030-01-01T00:00:00Z",
    expires_at: "2030-01-01T01:00:00Z",
    approved: true,
    read_only: true,
    applies_sql: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
    ...overrides,
  };
}

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
    revocation_source: "platform_semantic_capabilities",
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
    observed_at: "2030-01-01T00:02:00Z",
    pagination: {
      expected_count: records.length,
      observed_count: records.length,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`run:${family}-1`],
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

function collectors(invocations) {
  return Object.fromEntries(AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map((family) => [
    family,
    async (context) => {
      invocations.push({ family, context });
      assert.equal(Object.isFrozen(context), true);
      assert.equal(context.source_family, family);
      assert.equal(context.target_schema, "platform");
      assert.equal(context.read_only, true);
      assert.equal(context.applies_sql, false);
      return source(family);
    },
  ]));
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
      observed_at: "2030-01-01T00:03:00Z",
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

const invocations = [];
const packet = await collectGovernedAuthorityLiveEvidence({
  operation_authorization: authorization(),
  source_collectors: collectors(invocations),
  catalog_collector: async ({ schemaName }) => {
    assert.equal(schemaName, "platform");
    return catalog();
  },
  now: "2030-01-01T00:05:00Z",
});

assert.equal(packet.contract, "mad4b.ueacp.authority-live-evidence-packet.v1");
assert.equal(packet.status, "ready_for_human_ownership_review");
assert.equal(invocations.length, 8);
assert.deepEqual(invocations.map((item) => item.family), [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort());
assert.equal(packet.source_bundle.source_family_count, 8);
assert.equal(packet.source_bundle.blocking_gap_count, 0);
assert.equal(packet.catalog_census.schema_name, "platform");
assert.equal(packet.cycle.observation_count, 9);
assert.equal(packet.cycle.observation_spread_ms, 60_000);
assert.equal(packet.closure_state.t001_complete, false);
assert.equal(packet.closure_state.t002_complete, false);
assert.equal(packet.closure_state.live_evidence_ready_for_human_ownership_review, true);
assert.equal(packet.closure_state.migration_design_input_ready, false);
assert.equal(packet.closure_state.migration_apply_authorized, false);
assert.equal(packet.read_only, true);
assert.equal(packet.applies_sql, false);
assert.equal(packet.runtime_authority_changed, false);
assert.equal(packet.provider_calls, false);
assert.equal(packet.credential_payload_read, false);
assert.equal(packet.external_writes, false);
assert.equal(packet.secrets_included, false);
assert.match(packet.packet_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(packet), true);

const reviewPacket = finalizeGovernedAuthorityLiveEvidence({
  live_evidence_packet: packet,
  review_entries: reviewEntries(),
  reviewer_key: "platform_architecture_review",
  reviewed_at: "2030-01-01T00:10:00Z",
  readback_ref: "readback:ueacp-live-evidence-1",
});

assert.equal(reviewPacket.contract, "mad4b.ueacp.authority-live-evidence-review-packet.v1");
assert.equal(reviewPacket.status, "ready_for_human_t001_t002_closeout");
assert.equal(reviewPacket.ownership_review.status, "ready_for_human_task_closure_review");
assert.equal(reviewPacket.closure_state.t001_complete, false);
assert.equal(reviewPacket.closure_state.t002_complete, false);
assert.equal(reviewPacket.closure_state.t001_ready_for_human_closure, true);
assert.equal(reviewPacket.closure_state.t002_ready_for_human_closure, true);
assert.equal(reviewPacket.closure_state.migration_design_input_ready_after_explicit_closeout, true);
assert.equal(reviewPacket.closure_state.migration_apply_authorized, false);
assert.equal(reviewPacket.closure_state.tasks_auto_closed, false);
assert.equal(reviewPacket.bindings.source_bundle_sha256, packet.source_bundle.bundle_sha256);
assert.equal(reviewPacket.bindings.inventory_sha256, packet.source_bundle.inventory.inventory_sha256);
assert.match(reviewPacket.review_packet_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(reviewPacket), true);

console.log("authority live evidence orchestrator tests passed");
