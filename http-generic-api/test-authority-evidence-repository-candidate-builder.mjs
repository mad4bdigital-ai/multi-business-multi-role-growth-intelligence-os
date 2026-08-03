import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AUTHORITY_EVIDENCE_REPOSITORY_CANDIDATE_INDEX_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AuthorityEvidenceRepositoryCandidateError,
  buildAuthorityEvidenceRepositoryCandidates,
} from "./authorityEvidenceRepositoryCandidateBuilder.js";
import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";
import { runAuthorityEvidenceRepositoryCandidates } from "./scripts/authority-evidence-repository-candidates.mjs";

function pathRecord(family, index) {
  return {
    path_key: `${family}.path.${index}`,
    canonical_tool_key: `${family}.tool.${index}`,
    route: null,
    method: null,
    surface_family: family,
    source_registry: family,
    handler_key: `${family}.handler.${index}`,
    authority_mode: "shared",
    operation_mode: "read_only",
    callability: "authorization_gated",
    status: "active",
    actor_source: "authenticated_principal",
    subject_source: "effective_subject_scope",
    tenant_scope_source: "principal_tenant_scope",
    workspace_scope_source: "principal_workspace_scope",
    resource_authority_source: "resource_authority_bindings",
    capability_authority_source: "platform_semantic_capabilities",
    provider_scope_source: "provider_connection_bindings",
    credential_scope_source: "credential_reference_metadata",
    risk_class: "low",
    revision_source: `${family}.updated_at`,
    freshness_source: `${family}.updated_at`,
    revocation_source: `${family}.status`,
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: "read_only_snapshot",
    replacement_path_key: null,
    aliases: [],
    requirements: {
      approval: false,
      typed_confirmation: false,
      capability_envelope: false,
      idempotency: false,
      readback: false,
      rollback: false,
    },
    credential_payload_read: false,
    secrets_included: false,
  };
}

function snapshots() {
  return AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map((family, index) => ({
    source_family: family,
    source_key: `live.${family}`,
    source_identity: `live.${family}.${String(index).padStart(2, "0")}`,
    observed_at: "2026-08-03T14:00:00.000Z",
    pagination: {
      expected_count: 1,
      observed_count: 1,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`operation-sha256:${"a".repeat(32)}`, `query:${family}`],
    records: [pathRecord(family, index)],
    safety: {
      read_only: true,
      provider_calls: false,
      credential_payload_read: false,
      external_writes: false,
      secrets_included: false,
    },
  }));
}

function build(overrides = {}) {
  return buildAuthorityEvidenceRepositoryCandidates({
    snapshots: snapshots(),
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    observed_ref: "a".repeat(40),
    generated_at: "2026-08-03T14:05:00.000Z",
    ...overrides,
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => (
    error instanceof AuthorityEvidenceRepositoryCandidateError
    && error.code === code
  ));
}

{
  const result = build();
  assert.equal(result.documents.length, 8);
  assert.equal(result.index.contract, AUTHORITY_EVIDENCE_REPOSITORY_CANDIDATE_INDEX_CONTRACT);
  assert.equal(result.index.source_document_contract, AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT);
  assert.equal(result.index.source_file_count, 8);
  assert.equal(result.index.manifest_status, "requires_post_commit_blob_binding");
  assert.equal(result.index.review_required, true);
  assert.equal(result.index.closes_t001, false);
  assert.equal(result.index.closes_t002, false);
  assert.equal(result.index.migration_apply_authorized, false);
  assert.equal(result.index.secrets_included, false);
  assert.match(result.index.candidate_index_sha256, /^[a-f0-9]{64}$/);
  for (const document of result.documents) {
    const parsed = JSON.parse(document.content);
    assert.equal(parsed.contract, AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT);
    assert.equal(parsed.source_family, document.source_family);
    assert.equal(parsed.capture.pagination.complete, true);
    assert.equal(parsed.safety.read_only, true);
    assert.equal(parsed.safety.secrets_included, false);
    assert.match(document.content_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(parsed, "blob_sha"), false);
    assert.equal(document.content.includes("authority-evidence-repository-manifest.v1"), false);
  }
  assert.ok(result.index.source_files.every((source) => !Object.hasOwn(source, "blob_sha")));
}

{
  const missing = snapshots();
  missing.pop();
  expectCode(
    () => build({ snapshots: missing }),
    "authority_evidence_repository_candidate_incomplete_family_set",
  );
}

{
  const duplicate = snapshots();
  duplicate[7].source_family = duplicate[0].source_family;
  expectCode(
    () => build({ snapshots: duplicate }),
    "authority_evidence_repository_candidate_incomplete_family_set",
  );
}

{
  const unsafe = snapshots();
  unsafe[0].safety.external_writes = true;
  expectCode(
    () => build({ snapshots: unsafe }),
    "authority_evidence_repository_candidate_unsafe_snapshot",
  );
}

{
  const incomplete = snapshots();
  incomplete[0].pagination.complete = false;
  expectCode(
    () => build({ snapshots: incomplete }),
    "authority_evidence_repository_candidate_incomplete_pagination",
  );
}

{
  const sensitive = snapshots();
  sensitive[0].records[0].access_token = "forbidden";
  expectCode(
    () => build({ snapshots: sensitive }),
    "authority_evidence_repository_candidate_sensitive_value_forbidden",
  );
}

{
  const oversizedRows = snapshots();
  oversizedRows[0].records = Array.from({ length: 8193 }, (_, index) => ({ path_key: `row.${index}` }));
  oversizedRows[0].pagination.expected_count = 8193;
  oversizedRows[0].pagination.observed_count = 8193;
  expectCode(
    () => build({ snapshots: oversizedRows }),
    "authority_evidence_repository_candidate_invalid_records",
  );
}

{
  expectCode(
    () => build({ observed_ref: "not-a-sha" }),
    "authority_evidence_repository_candidate_invalid_commit_sha",
  );
}

{
  expectCode(
    () => build({ source_directory: "../escaped" }),
    "authority_evidence_repository_candidate_unsafe_output_directory",
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-candidate-cli-"));
  try {
    const input = path.join(root, "snapshots.json");
    fs.writeFileSync(input, `${JSON.stringify({ source_bundle: { sources: snapshots() } }, null, 2)}\n`);
    const args = [
      "--input-file", input,
      "--repository", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      "--observed-ref", "b".repeat(40),
      "--repository-root", root,
      "--source-directory", "specs/011-unified-effective-authority-control-plane/evidence-sources",
      "--index-output", "specs/011-unified-effective-authority-control-plane/evidence-sources/candidate-index.json",
      "--generated-at", "2026-08-03T14:10:00.000Z",
    ];
    assert.equal(runAuthorityEvidenceRepositoryCandidates(args), 0);
    assert.equal(fs.existsSync(path.join(root, "specs")), false);
    assert.equal(runAuthorityEvidenceRepositoryCandidates([...args, "--write"]), 0);
    const outputRoot = path.join(root, "specs/011-unified-effective-authority-control-plane/evidence-sources");
    assert.equal(fs.readdirSync(outputRoot).filter((name) => name.endsWith(".json")).length, 9);
    const index = JSON.parse(fs.readFileSync(path.join(outputRoot, "candidate-index.json"), "utf8"));
    assert.equal(index.source_file_count, 8);
    assert.equal(index.observed_ref, "b".repeat(40));
    assert.equal(index.manifest_status, "requires_post_commit_blob_binding");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-candidate-symlink-root-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-candidate-symlink-external-"));
  try {
    const input = path.join(root, "snapshots.json");
    fs.writeFileSync(input, `${JSON.stringify(snapshots(), null, 2)}\n`);
    fs.symlinkSync(external, path.join(root, "specs"), "dir");
    assert.throws(
      () => runAuthorityEvidenceRepositoryCandidates([
        "--input-file", input,
        "--repository", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        "--observed-ref", "c".repeat(40),
        "--repository-root", root,
        "--write",
      ]),
      /symbolic-link path component/,
    );
    assert.equal(fs.readdirSync(external).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
}

console.log("authority evidence repository candidate builder tests passed");
