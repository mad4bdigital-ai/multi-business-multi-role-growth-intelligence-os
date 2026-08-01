import assert from "node:assert/strict";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";
import {
  AuthorityLiveEvidenceError,
  collectGovernedAuthorityLiveEvidence,
  finalizeGovernedAuthorityLiveEvidence,
} from "./authorityLiveEvidenceOrchestrator.js";

function authorization(overrides = {}) {
  return {
    contract: "mad4b.ueacp.authority-live-evidence-authorization.v1",
    operation_mode: "read_only_live_authority_evidence",
    operation_ref: "operation:ueacp-live-evidence-fail-closed",
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
  return {
    source_family: family,
    source_key: `${family}.snapshot`,
    source_identity: `${family}.snapshot-2030-01-01`,
    observed_at: "2030-01-01T00:02:00Z",
    pagination: {
      expected_count: 1,
      observed_count: 1,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`run:${family}-1`],
    records: [pathRecord(family)],
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

function collectors(overrides = {}) {
  return Object.fromEntries(AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map((family) => [
    family,
    overrides[family] ?? (async () => source(family)),
  ]));
}

function catalog(overrides = {}) {
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
    ],
    revision_support: [
      { object_name: "platform_semantic_capabilities", support: "explicit_revision", explicit_revision_columns: ["revision"], temporal_freshness_columns: ["updated_at"], requires_authoritative_owner_review: true },
    ],
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
    ...overrides,
  };
}

async function collect(overrides = {}) {
  return collectGovernedAuthorityLiveEvidence({
    operation_authorization: overrides.operation_authorization ?? authorization(),
    source_collectors: overrides.source_collectors ?? collectors(),
    catalog_collector: overrides.catalog_collector ?? (async () => catalog()),
    now: overrides.now ?? "2030-01-01T00:05:00Z",
  });
}

await assert.rejects(
  () => collect({ operation_authorization: authorization({ approved: false }) }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_unsafe_authorization",
);

await assert.rejects(
  () => collect({ operation_authorization: authorization({ applies_sql: true }) }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_unsafe_authorization",
);

await assert.rejects(
  () => collect({ operation_authorization: authorization({ access_token: "forbidden" }) }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_sensitive_value_forbidden",
);

await assert.rejects(
  () => collect({ now: "2030-01-01T01:00:01Z" }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_authorization_inactive",
);

const missingCollectors = collectors();
delete missingCollectors.compatibility_alias_registry;
await assert.rejects(
  () => collect({ source_collectors: missingCollectors }),
  (error) => error instanceof AuthorityLiveEvidenceError
    && error.code === "authority_live_evidence_incomplete_collectors"
    && error.details.missing_source_families.includes("compatibility_alias_registry"),
);

await assert.rejects(
  () => collect({
    source_collectors: collectors({
      system_tool_registry: async () => source("admin_endpoint_catalog"),
    }),
  }),
  (error) => error instanceof AuthorityLiveEvidenceError
    && error.code === "authority_live_evidence_collector_family_mismatch",
);

await assert.rejects(
  () => collect({ catalog_collector: async () => catalog({ schema_name: "other_schema" }) }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_schema_mismatch",
);

await assert.rejects(
  () => collect({ catalog_collector: async () => catalog({ provider_calls: true }) }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_unsafe_catalog",
);

await assert.rejects(
  () => collect({
    source_collectors: collectors({
      local_device_catalog: async () => source("local_device_catalog", { observed_at: "2030-01-01T00:30:00Z" }),
    }),
  }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_cycle_spread_exceeded",
);

await assert.rejects(
  () => collect({
    source_collectors: collectors({
      local_device_catalog: async () => source("local_device_catalog", { observed_at: "2030-01-01T01:00:01Z" }),
    }),
  }),
  (error) => error instanceof AuthorityLiveEvidenceError
    && error.code === "authority_live_evidence_observation_outside_authorization",
);

const packet = await collect();
assert.throws(
  () => finalizeGovernedAuthorityLiveEvidence({
    live_evidence_packet: { ...packet, status: "tampered" },
    review_entries: [],
    reviewer_key: "platform_architecture_review",
    reviewed_at: "2030-01-01T00:10:00Z",
    readback_ref: "readback:ueacp-live-evidence-fail-closed",
  }),
  (error) => error instanceof AuthorityLiveEvidenceError && error.code === "authority_live_evidence_stale_packet_hash",
);

assert.throws(
  () => finalizeGovernedAuthorityLiveEvidence({
    live_evidence_packet: packet,
    review_entries: [],
    reviewer_key: "platform_architecture_review",
    reviewed_at: "2030-01-01T00:01:00Z",
    readback_ref: "readback:ueacp-live-evidence-fail-closed",
  }),
  (error) => error instanceof AuthorityLiveEvidenceError
    && error.code === "authority_live_evidence_review_precedes_observation",
);

console.log("authority live evidence fail-closed tests passed");
