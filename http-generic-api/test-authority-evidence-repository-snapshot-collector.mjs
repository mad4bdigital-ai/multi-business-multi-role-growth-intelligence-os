import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AuthorityEvidenceRepositorySnapshotError,
  collectAuthorityEvidenceRepositorySnapshots,
} from "./authorityEvidenceRepositorySnapshotCollector.js";
import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function completePath(family, index) {
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
    callability: "callable",
    status: "active",
    actor_source: "request.actor",
    subject_source: "request.subject",
    tenant_scope_source: "request.tenant",
    workspace_scope_source: "request.workspace",
    resource_authority_source: "resource.authority",
    capability_authority_source: "capability.authority",
    provider_scope_source: "provider.scope",
    credential_scope_source: "credential.scope",
    risk_class: "low",
    revision_source: "authority_scope_registry",
    freshness_source: "updated_at",
    revocation_source: "revoked_at",
    invalidation_source: "authority_invalidation_events",
    atomicity_policy: "read_only",
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

function createFixture(transformDocument = (value) => value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-evidence-"));
  const blobByFile = new Map();
  const sources = [];
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES.forEach((family, index) => {
    const sourceFile = `evidence/${family}.json`;
    const absolute = path.join(root, sourceFile);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const base = {
      contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
      source_family: family,
      source_key: `${family}.canonical`,
      source_identity: `${family}.repository.v1`,
      evidence_refs: [`source:${family}`],
      records: [completePath(family, index)],
      safety: {
        read_only: true,
        provider_calls: false,
        credential_payload_read: false,
        external_writes: false,
        secrets_included: false,
      },
    };
    const document = transformDocument(structuredClone(base), family, index);
    const text = `${JSON.stringify(document, null, 2)}\n`;
    fs.writeFileSync(absolute, text);
    const blobSha = crypto.createHash("sha1").update(`blob:${family}:${text}`).digest("hex");
    blobByFile.set(sourceFile, blobSha);
    sources.push({
      source_family: family,
      source_file: sourceFile,
      blob_sha: blobSha,
      content_sha256: sha256Text(text),
    });
  });
  return {
    root,
    blobByFile,
    manifest: {
      contract: AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      observed_ref: "1".repeat(40),
      sources,
    },
  };
}

function collect(fixture, manifest = fixture.manifest) {
  return collectAuthorityEvidenceRepositorySnapshots({
    manifest,
    repository_root: fixture.root,
    now: "2026-08-03T05:00:00.000Z",
    resolve_blob_sha: (_root, _ref, sourceFile) => fixture.blobByFile.get(sourceFile),
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => (
    error instanceof AuthorityEvidenceRepositorySnapshotError
    && error.code === code
  ));
}

{
  const fixture = createFixture();
  try {
    const attestation = collect(fixture);
    assert.equal(attestation.status, "ready_for_live_catalog_cycle");
    assert.equal(attestation.source_files.length, 8);
    assert.equal(attestation.snapshots.length, 8);
    assert.equal(attestation.blocking_gap_count, 0);
    assert.equal(attestation.read_only, true);
    assert.equal(attestation.applies_sql, false);
    assert.equal(attestation.runtime_authority_changed, false);
    assert.equal(attestation.provider_calls, false);
    assert.equal(attestation.credential_payload_read, false);
    assert.equal(attestation.external_writes, false);
    assert.equal(attestation.secrets_included, false);
    assert.match(attestation.attestation_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      attestation.snapshots.map((source) => source.source_family),
      [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort(),
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture((document, family) => {
    if (family === "runtime_action_registry") delete document.records[0].revision_source;
    return document;
  });
  try {
    const attestation = collect(fixture);
    assert.equal(attestation.status, "blocked");
    assert.ok(attestation.blocking_gap_count > 0);
    assert.ok(attestation.gaps.some((gap) => gap.path_key === "runtime_action_registry.path.3"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  try {
    const manifest = structuredClone(fixture.manifest);
    manifest.sources[0].blob_sha = "f".repeat(40);
    expectCode(() => collect(fixture, manifest), "authority_evidence_repository_blob_mismatch");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  try {
    const manifest = structuredClone(fixture.manifest);
    manifest.sources[0].content_sha256 = "f".repeat(64);
    expectCode(() => collect(fixture, manifest), "authority_evidence_repository_content_hash_mismatch");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  try {
    const manifest = structuredClone(fixture.manifest);
    manifest.sources[0].source_file = "../escaped.json";
    expectCode(() => collect(fixture, manifest), "authority_evidence_repository_unsafe_source_path");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-evidence-external-"));
  try {
    const sourceFile = fixture.manifest.sources[0].source_file;
    const sourcePath = path.join(fixture.root, sourceFile);
    const externalPath = path.join(externalRoot, "outside.json");
    fs.writeFileSync(externalPath, "{}\n");
    fs.unlinkSync(sourcePath);
    fs.symlinkSync(externalPath, sourcePath, "file");
    expectCode(() => collect(fixture), "authority_evidence_repository_unsafe_source_file_type");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-repository-evidence-linked-directory-"));
  try {
    const originalBinding = fixture.manifest.sources[0];
    const originalPath = path.join(fixture.root, originalBinding.source_file);
    const sourceText = fs.readFileSync(originalPath, "utf8");
    const linkedSourceFile = "linked/source.json";
    fs.writeFileSync(path.join(externalRoot, "source.json"), sourceText);
    fs.symlinkSync(externalRoot, path.join(fixture.root, "linked"), "dir");
    const manifest = structuredClone(fixture.manifest);
    manifest.sources[0].source_file = linkedSourceFile;
    manifest.sources[0].content_sha256 = sha256Text(sourceText);
    fixture.blobByFile.set(linkedSourceFile, originalBinding.blob_sha);
    expectCode(() => collect(fixture, manifest), "authority_evidence_repository_source_path_escape");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  try {
    const sourcePath = path.join(fixture.root, fixture.manifest.sources[0].source_file);
    fs.writeFileSync(sourcePath, Buffer.alloc((8 * 1024 * 1024) + 1, 0x20));
    expectCode(() => collect(fixture), "authority_evidence_repository_source_file_too_large");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture((document, family) => {
    if (family === "provider_binding_catalog") document.records[0].access_token = "forbidden";
    return document;
  });
  try {
    expectCode(() => collect(fixture), "authority_evidence_repository_sensitive_value_forbidden");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = createFixture();
  try {
    const manifest = structuredClone(fixture.manifest);
    manifest.sources.pop();
    expectCode(() => collect(fixture, manifest), "authority_evidence_repository_incomplete_family_manifest");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

console.log("authority evidence repository snapshot collector tests passed");
