import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";
import {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
  AuthorityEvidenceRepositorySourceMaterializationError,
  finalizeAuthorityEvidenceRepositoryManifest,
  materializeAuthorityEvidenceRepositorySourceDocuments,
} from "./authorityEvidenceRepositorySourceMaterializer.js";
import {
  _testingAuthorityEvidenceRepositorySourceMaterialize as sourceMaterializeCli,
} from "./scripts/authority-evidence-repository-source-materialize.mjs";
import {
  _testingAuthorityEvidenceRepositoryManifestFinalize as manifestFinalizeCli,
} from "./scripts/authority-evidence-repository-manifest-finalize.mjs";

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
    source_identity: `${family}.snapshot.2030-01-01`,
    observed_at: "2030-01-01T00:00:00Z",
    pagination: {
      expected_count: records.length,
      observed_count: records.length,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: [`run:${family}:1`],
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

function allSources(overridesByFamily = {}) {
  return AUTHORITY_EVIDENCE_SOURCE_FAMILIES.map(
    (family) => source(family, overridesByFamily[family] || {}),
  );
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return String(result.stdout || "").trim();
}

function expectObject(expected) {
  return {
    ...expected,
    repositoryRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
  };
}

const materialized = materializeAuthorityEvidenceRepositorySourceDocuments({ sources: allSources() });
assert.equal(materialized.report.contract, AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT);
assert.equal(materialized.report.status, "ready_for_repository_review");
assert.equal(materialized.report.source_document_count, 8);
assert.equal(materialized.report.source_files.length, 8);
assert.equal(materialized.report.repository_mutation_performed, false);
assert.equal(materialized.report.secrets_included, false);
assert.match(materialized.report.materialization_sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(
  materialized.documents.map((entry) => entry.source_family),
  [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort(),
);
for (const entry of materialized.documents) {
  const document = JSON.parse(entry.content);
  assert.equal(document.contract, AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT);
  assert.equal(document.source_family, entry.source_family);
  assert.equal(document.records.length, 1);
  assert.equal(document.safety.read_only, true);
  assert.equal(document.safety.secrets_included, false);
  assert.match(entry.content_sha256, /^[a-f0-9]{64}$/);
}

const repeated = materializeAuthorityEvidenceRepositorySourceDocuments({ sources: allSources() });
assert.equal(repeated.report.materialization_sha256, materialized.report.materialization_sha256);
assert.deepEqual(
  repeated.documents.map((entry) => entry.content_sha256),
  materialized.documents.map((entry) => entry.content_sha256),
);

assert.throws(
  () => materializeAuthorityEvidenceRepositorySourceDocuments({ sources: allSources().slice(0, -1) }),
  (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
    && error.code === "authority_evidence_repository_sources_not_ready",
);
assert.throws(
  () => materializeAuthorityEvidenceRepositorySourceDocuments({
    sources: allSources({
      system_tool_registry: {
        records: [{ ...pathRecord("system_tool_registry"), access_token: "forbidden" }],
      },
    }),
  }),
  (error) => error?.code === "authority_evidence_secret_value_forbidden",
);
assert.throws(
  () => materializeAuthorityEvidenceRepositorySourceDocuments({
    sources: allSources(),
    source_directory: "../escaped",
  }),
  (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
    && error.code === "authority_evidence_repository_materialization_unsafe_path",
);

assert.deepEqual(sourceMaterializeCli.parseArgs([
  "--sources-file=sources.json",
  "--output-dir=specs/011/source-docs",
  "--report-file=specs/011/materialization.json",
]), expectObject({
  sourcesFile: "sources.json",
  outputDir: "specs/011/source-docs",
  reportFile: "specs/011/materialization.json",
}));
assert.deepEqual(manifestFinalizeCli.parseArgs([
  "--materialization-report=specs/011/materialization.json",
  "--repository=owner/repo",
  "--observed-ref=0123456789012345678901234567890123456789",
  "--manifest-output=specs/011/manifest.json",
]), expectObject({
  materializationReport: "specs/011/materialization.json",
  repository: "owner/repo",
  observedRef: "0123456789012345678901234567890123456789",
  manifestOutput: "specs/011/manifest.json",
}));

const writerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-source-writer-"));
const writerOutside = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-source-writer-outside-"));
try {
  fs.mkdirSync(path.join(writerRoot, "review"), { recursive: true });
  fs.writeFileSync(path.join(writerRoot, "review", "existing.json"), "existing\n");
  assert.throws(
    () => sourceMaterializeCli.writeNewFilesAtomically(writerRoot, [
      { relativePath: "review/first.json", content: "first\n" },
      { relativePath: "review/existing.json", content: "replace\n" },
    ]),
    /Refusing to overwrite existing file/,
  );
  assert.equal(fs.existsSync(path.join(writerRoot, "review", "first.json")), false);
  assert.equal(fs.readFileSync(path.join(writerRoot, "review", "existing.json"), "utf8"), "existing\n");

  fs.symlinkSync(writerOutside, path.join(writerRoot, "linked"), "dir");
  assert.throws(
    () => sourceMaterializeCli.writeNewFilesAtomically(writerRoot, [
      { relativePath: "linked/escape.json", content: "escape\n" },
    ]),
    /Unsafe intermediate output directory/,
  );
  assert.equal(fs.existsSync(path.join(writerOutside, "escape.json")), false);
  assert.throws(
    () => manifestFinalizeCli.writeNewFile(writerRoot, "linked/manifest.json", "{}\n"),
    /Unsafe intermediate output directory/,
  );
  assert.equal(fs.existsSync(path.join(writerOutside, "manifest.json")), false);

  const originalLinkSync = fs.linkSync;
  let linkCount = 0;
  fs.linkSync = (...args) => {
    linkCount += 1;
    if (linkCount === 2) throw Object.assign(new Error("forced second-file failure"), { code: "EIO" });
    return originalLinkSync(...args);
  };
  try {
    assert.throws(
      () => sourceMaterializeCli.writeNewFilesAtomically(writerRoot, [
        { relativePath: "rollback/one.json", content: "one\n" },
        { relativePath: "rollback/two.json", content: "two\n" },
      ]),
      /forced second-file failure/,
    );
  } finally {
    fs.linkSync = originalLinkSync;
  }
  assert.equal(fs.existsSync(path.join(writerRoot, "rollback", "one.json")), false);
  assert.equal(fs.existsSync(path.join(writerRoot, "rollback", "two.json")), false);

  const originalUnlinkSync = fs.unlinkSync;
  let forcedTemporaryUnlinkFailure = false;
  fs.unlinkSync = (filePath) => {
    if (!forcedTemporaryUnlinkFailure && String(filePath).endsWith(".tmp")) {
      forcedTemporaryUnlinkFailure = true;
      throw Object.assign(new Error("forced temporary unlink failure"), { code: "EIO" });
    }
    return originalUnlinkSync(filePath);
  };
  try {
    assert.throws(
      () => sourceMaterializeCli.writeNewFilesAtomically(writerRoot, [
        { relativePath: "unlink-rollback/one.json", content: "one\n" },
      ]),
      /forced temporary unlink failure/,
    );
  } finally {
    fs.unlinkSync = originalUnlinkSync;
  }
  assert.equal(fs.existsSync(path.join(writerRoot, "unlink-rollback", "one.json")), false);

  const originalManifestLinkSync = fs.linkSync;
  fs.linkSync = (_temporary, destination) => {
    fs.writeFileSync(destination, "raced\n", { flag: "wx" });
    throw Object.assign(new Error("simulated destination race"), { code: "EEXIST" });
  };
  try {
    assert.throws(
      () => manifestFinalizeCli.writeNewFile(writerRoot, "race/manifest.json", "ours\n"),
      /simulated destination race/,
    );
  } finally {
    fs.linkSync = originalManifestLinkSync;
  }
  assert.equal(fs.readFileSync(path.join(writerRoot, "race", "manifest.json"), "utf8"), "raced\n");

  sourceMaterializeCli.writeNewFilesAtomically(writerRoot, [
    { relativePath: "success/one.json", content: "one\n" },
    { relativePath: "success/two.json", content: "two\n" },
  ]);
  assert.equal(fs.readFileSync(path.join(writerRoot, "success", "one.json"), "utf8"), "one\n");
  assert.equal(fs.readFileSync(path.join(writerRoot, "success", "two.json"), "utf8"), "two\n");
} finally {
  fs.rmSync(writerRoot, { recursive: true, force: true });
  fs.rmSync(writerOutside, { recursive: true, force: true });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ueacp-source-materialization-"));
try {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  git(root, ["config", "user.name", "UEACP Tests"]);
  for (const entry of materialized.documents) {
    const absolute = path.join(root, entry.source_file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, entry.content);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "test: add reviewed authority source documents"]);
  const observedRef = git(root, ["rev-parse", "HEAD"]);

  const finalized = finalizeAuthorityEvidenceRepositoryManifest({
    materialization_report: materialized.report,
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    observed_ref: observedRef,
    repository_root: root,
  });
  assert.equal(finalized.manifest.contract, AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT);
  assert.equal(finalized.manifest.observed_ref, observedRef);
  assert.equal(finalized.source_document_count, 8);
  assert.equal(finalized.repository_mutation_performed, false);
  assert.equal(finalized.secrets_included, false);
  assert.match(finalized.manifest_sha256, /^[a-f0-9]{64}$/);
  for (const binding of finalized.manifest.sources) {
    assert.match(binding.blob_sha, /^[a-f0-9]{40}$/);
    assert.match(binding.content_sha256, /^[a-f0-9]{64}$/);
  }

  assert.throws(
    () => finalizeAuthorityEvidenceRepositoryManifest({
      materialization_report: {
        ...materialized.report,
        source_files: materialized.report.source_files.slice(0, -1),
      },
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      observed_ref: observedRef,
      repository_root: root,
    }),
    (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
      && error.code === "authority_evidence_repository_materialization_incomplete_report",
  );

  const first = materialized.documents[0];
  const firstPath = path.join(root, first.source_file);
  fs.appendFileSync(firstPath, "\n");
  assert.throws(
    () => finalizeAuthorityEvidenceRepositoryManifest({
      materialization_report: materialized.report,
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      observed_ref: observedRef,
      repository_root: root,
    }),
    (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
      && error.code === "authority_evidence_repository_materialization_current_content_mismatch",
  );

  const driftedText = fs.readFileSync(firstPath, "utf8");
  const driftedHash = crypto.createHash("sha256").update(driftedText).digest("hex");
  const driftedReport = {
    ...materialized.report,
    source_files: materialized.report.source_files.map((entry) => (
      entry.source_file === first.source_file ? { ...entry, content_sha256: driftedHash } : entry
    )),
  };
  assert.throws(
    () => finalizeAuthorityEvidenceRepositoryManifest({
      materialization_report: driftedReport,
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      observed_ref: observedRef,
      repository_root: root,
    }),
    (error) => error instanceof AuthorityEvidenceRepositorySourceMaterializationError
      && error.code === "authority_evidence_repository_materialization_reviewed_content_mismatch",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("authority evidence repository source materializer tests passed");
