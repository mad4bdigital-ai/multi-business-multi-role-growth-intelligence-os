import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";
import {
  AuthorityEvidenceRepositorySourceMaterializationError,
  finalizeAuthorityEvidenceRepositoryManifest,
  materializeAuthorityEvidenceRepositorySourceDocuments,
} from "./authorityEvidenceRepositorySourceMaterializer.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
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
    revocation_source: "platform_semantic_capabilities.status",
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: "read_only_snapshot",
    aliases: [],
    requirements: {},
    credential_payload_read: false,
    secrets_included: false,
  };
}

function source(family, index) {
  const records = [pathRecord(family)];
  return {
    source_family: family,
    source_key: `${family}.pagination.snapshot`,
    source_identity: `${family}.pagination.snapshot.2030`,
    observed_at: "2030-01-01T00:00:00Z",
    pagination: {
      expected_count: records.length,
      observed_count: records.length,
      page_count: index === 0 ? 3 : 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`run:${family}:pagination`],
    records,
    safety: {
      read_only: true,
      provider_calls: false,
      credential_payload_read: false,
      external_writes: false,
      secrets_included: false,
    },
  };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return String(result.stdout || "").trim();
}

const sources = AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map(source);
const materialized = materializeAuthorityEvidenceRepositorySourceDocuments({ sources });
assert.equal(materialized.documents.length, 8);
assert.equal(materialized.report.source_document_count, 8);
assert.equal(materialized.bundle.sources[0].pagination.page_count, 3);

const paginatedDocument = materialized.documents.find(
  (entry) => entry.source_family === AUTHORITY_EVIDENCE_SOURCE_FAMILIES[0],
);
assert(paginatedDocument);
assert.equal(JSON.parse(paginatedDocument.content).pagination.page_count, 3);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-pagination-roundtrip-"));
try {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "UEACP Pagination Tests"]);

  for (const entry of materialized.documents) {
    const absolutePath = path.join(root, entry.source_file);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, entry.content);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "test: add paginated reviewed authority sources"]);
  const observedRef = git(root, ["rev-parse", "HEAD"]);

  const finalized = finalizeAuthorityEvidenceRepositoryManifest({
    materialization_report: materialized.report,
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    observed_ref: observedRef,
    repository_root: root,
  });
  assert.equal(finalized.source_document_count, 8);
  assert.equal(finalized.source_bundle_sha256, materialized.report.source_bundle_sha256);
  assert.equal(finalized.inventory_sha256, materialized.report.inventory_sha256);
  assert.equal(finalized.materialization_sha256, materialized.report.materialization_sha256);

  const forgedUnsignedReport = {
    ...materialized.report,
    source_bundle_sha256: "0".repeat(64),
  };
  delete forgedUnsignedReport.materialization_sha256;
  const forgedReport = {
    ...forgedUnsignedReport,
    materialization_sha256: hash(forgedUnsignedReport),
  };
  assert.throws(
    () => finalizeAuthorityEvidenceRepositoryManifest({
      materialization_report: forgedReport,
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      observed_ref: observedRef,
      repository_root: root,
    }),
    (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
      && error.code === "authority_evidence_repository_materialization_noncanonical_report",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("authority evidence repository pagination round-trip tests passed");
