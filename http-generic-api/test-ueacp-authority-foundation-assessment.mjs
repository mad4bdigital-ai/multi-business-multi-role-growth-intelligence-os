import assert from "node:assert/strict";

import {
  UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS,
  UeacpAuthorityFoundationAssessmentError,
  assessUeacpAuthorityFoundation,
  createUeacpAuthorityCensusFingerprint,
} from "./ueacpAuthorityFoundationAssessment.js";

function census() {
  return {
    ok: true,
    read_only: true,
    applies_sql: false,
    schema_name: "platform",
    database_server: {
      version: "11.4.2-MariaDB",
      version_comment: "MariaDB Server",
      observed_at: "2030-01-01 00:00:00.000000",
    },
    objects: [
      { object_name: "principals", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "scope_grants", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "resource_edges", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "policy_grants", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "connections", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" },
      { object_name: "runtime_certifications", object_type: "BASE TABLE", ownership_classification: "authority_source_candidate" }
    ],
    columns: [],
    indexes: [],
    foreign_keys: [],
    views: [],
    revision_support: [
      { object_name: "principals", support: "explicit_revision" },
      { object_name: "scope_grants", support: "explicit_revision" },
      { object_name: "resource_edges", support: "temporal_freshness_only" },
      { object_name: "policy_grants", support: "explicit_revision" },
      { object_name: "connections", support: "explicit_revision" },
      { object_name: "runtime_certifications", support: "temporal_freshness_only" }
    ],
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false
  };
}

function classificationBundle(inputCensus = census()) {
  const existing = {
    principal_authority: ["principals", "existing_explicit_revision", "source_authority", "reuse"],
    subject_scope_authority: ["scope_grants", "existing_explicit_revision", "source_authority", "reuse"],
    resource_relation_authority: ["resource_edges", "add_explicit_revision", "source_authority", "extend"],
    policy_grant_authority: ["policy_grants", "existing_explicit_revision", "source_authority", "reuse"],
    connection_authority: ["connections", "existing_explicit_revision", "source_authority", "reuse"],
    endpoint_certification_authority: ["runtime_certifications", "add_explicit_revision", "source_authority", "extend"]
  };
  const proposed = {
    delegation_context_authority: ["ueacp_delegation_contexts", "immutable_version_pointer", "source_authority"],
    resource_restriction_authority: ["ueacp_resource_restrictions", "immutable_version_pointer", "source_authority"],
    decision_evidence_ledger: ["ueacp_effective_authority_decisions", "append_only_event_revision", "append_only_evidence"],
    projection_snapshot_ledger: ["ueacp_authority_projection_snapshots", "immutable_version_pointer", "derived_projection"],
    invalidation_event_ledger: ["ueacp_authority_invalidation_events", "append_only_event_revision", "append_only_event"],
    drift_finding_ledger: ["ueacp_authority_drift_findings", "append_only_event_revision", "append_only_evidence"]
  };

  const classifications = UEACP_AUTHORITY_FOUNDATION_LOGICAL_KEYS.map((logicalKey) => {
    if (existing[logicalKey]) {
      const [objectName, revisionStrategy, storageSemantics, disposition] = existing[logicalKey];
      return {
        logical_key: logicalKey,
        disposition,
        owner_key: "context_kernel",
        approved: true,
        storage_semantics: storageSemantics,
        revision_strategy: revisionStrategy,
        object_names: [objectName],
        evidence_refs: [`census:${objectName}`],
        rationale: `Reuse or extend ${objectName} because its observed semantics match the UEACP logical authority family.`
      };
    }
    const [proposedObjectName, revisionStrategy, storageSemantics] = proposed[logicalKey];
    return {
      logical_key: logicalKey,
      disposition: "create",
      owner_key: "context_kernel",
      approved: true,
      storage_semantics: storageSemantics,
      revision_strategy: revisionStrategy,
      object_names: [],
      proposed_object_name: proposedObjectName,
      evidence_refs: [`gap:${logicalKey}`],
      rationale: `Create ${proposedObjectName} only because the exact logical semantics are absent from the observed census.`
    };
  });

  return {
    contract: "mad4b.ueacp-authority-foundation-classification.v1",
    census_sha256: createUeacpAuthorityCensusFingerprint(inputCensus),
    classification_source: "human-reviewed live SQL census classification",
    classifications
  };
}

const observed = census();
const bundle = classificationBundle(observed);
const report = assessUeacpAuthorityFoundation({ census: observed, classificationBundle: bundle });

assert.equal(report.ok, true);
assert.equal(report.status, "ready_for_additive_migration_design");
assert.equal(report.census_bound, true);
assert.equal(report.classifications.length, 12);
assert.equal(report.migration_actions.length, 8);
assert.deepEqual(report.blockers, {
  missing_logical_keys: [],
  unexpected_logical_keys: [],
  blocked_logical_keys: [],
  unapproved_logical_keys: [],
  census_fingerprint_mismatch: false
});
assert.deepEqual(report.closure_state, {
  t001_inventory_evidence_ready: true,
  t002_live_table_ownership_complete: true,
  t021_revision_design_authorized: true,
  t022_t024_storage_design_authorized: true,
  migration_apply_authorized: false,
  runtime_consumer_activation_authorized: false
});
assert.deepEqual(report.safety, {
  read_only: true,
  applies_sql: false,
  provider_calls: false,
  credential_payload_read: false,
  external_writes: false,
  secrets_included: false,
  runtime_authority_changed: false
});
assert.equal(Object.isFrozen(report), true);
assert.equal(Object.isFrozen(report.classifications), true);
assert.equal(Object.isFrozen(report.classifications[0]), true);

const reorderedReport = assessUeacpAuthorityFoundation({
  census: observed,
  classificationBundle: { ...bundle, classifications: [...bundle.classifications].reverse() }
});
assert.equal(reorderedReport.assessment_sha256, report.assessment_sha256);

const staleReport = assessUeacpAuthorityFoundation({
  census: observed,
  classificationBundle: { ...bundle, census_sha256: "0".repeat(64) }
});
assert.equal(staleReport.ok, false);
assert.equal(staleReport.blockers.census_fingerprint_mismatch, true);
assert.equal(staleReport.closure_state.migration_apply_authorized, false);

const missingReport = assessUeacpAuthorityFoundation({
  census: observed,
  classificationBundle: { ...bundle, classifications: bundle.classifications.slice(1) }
});
assert.equal(missingReport.ok, false);
assert.deepEqual(missingReport.blockers.missing_logical_keys, ["principal_authority"]);

await assert.rejects(
  async () => assessUeacpAuthorityFoundation({
    census: observed,
    classificationBundle: {
      ...bundle,
      classifications: bundle.classifications.map((item) => (
        item.logical_key === "delegation_context_authority"
          ? { ...item, proposed_object_name: "principals" }
          : item
      ))
    }
  }),
  (error) => error instanceof UeacpAuthorityFoundationAssessmentError
    && error.code === "ueacp_foundation_create_conflict"
);

await assert.rejects(
  async () => assessUeacpAuthorityFoundation({
    census: observed,
    classificationBundle: {
      ...bundle,
      classifications: bundle.classifications.map((item) => (
        item.logical_key === "delegation_context_authority"
          ? { ...item, authorization_token: "forbidden" }
          : item
      ))
    }
  }),
  (error) => error instanceof UeacpAuthorityFoundationAssessmentError
    && error.code === "ueacp_foundation_sensitive_field"
);

await assert.rejects(
  async () => assessUeacpAuthorityFoundation({
    census: observed,
    classificationBundle: {
      ...bundle,
      classifications: bundle.classifications.map((item) => (
        item.logical_key === "resource_relation_authority"
          ? { ...item, object_names: ["principals"], shared_object: false }
          : item
      ))
    }
  }),
  (error) => error instanceof UeacpAuthorityFoundationAssessmentError
    && error.code === "ueacp_foundation_ambiguous_object_ownership"
);

await assert.rejects(
  async () => assessUeacpAuthorityFoundation({
    census: { ...observed, external_writes: true },
    classificationBundle: bundle
  }),
  (error) => error instanceof UeacpAuthorityFoundationAssessmentError
    && error.code === "ueacp_foundation_unsafe_census"
);

console.log("UEACP authority foundation assessment tests passed");
