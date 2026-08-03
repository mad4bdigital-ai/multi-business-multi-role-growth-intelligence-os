import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  buildAuthorityEvidenceSourceBundle,
} from "./authorityEvidenceSourceAdapters.js";

export const AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-manifest.v1";
export const AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-source.v1";
export const AUTHORITY_EVIDENCE_REPOSITORY_ATTESTATION_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-attestation.v1";

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;

export class AuthorityEvidenceRepositorySnapshotError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityEvidenceRepositorySnapshotError";
    this.code = code;
    this.details = details;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertNoSensitiveValues(value, location = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null && nested !== undefined) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_sensitive_value_forbidden",
        "Repository authority evidence must not contain secret-bearing values.",
        { location: `${location}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${location}.${key}`, seen);
  }
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_token",
      `${field} must be a bounded canonical token.`,
      { field },
    );
  }
  return normalized;
}

function commitSha(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_commit_sha",
      `${field} must be a lowercase full commit SHA.`,
      { field },
    );
  }
  return normalized;
}

function digest(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_digest",
      `${field} must be a lowercase SHA-256 digest.`,
      { field },
    );
  }
  return normalized;
}

function timestamp(value, field) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_timestamp",
      `${field} must be a valid timestamp.`,
      { field },
    );
  }
  return parsed.toISOString();
}

function safeRelativeFile(value, field) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_unsafe_source_path",
      `${field} must be a safe repository-relative file path.`,
      { field },
    );
  }
  return normalized;
}

function defaultResolveBlobSha(repositoryRoot, observedRef, sourceFile) {
  const result = spawnSync("git", ["rev-parse", `${observedRef}:${sourceFile}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_blob_unavailable",
      "The declared source file is not present at the observed repository ref.",
      { source_file: sourceFile },
    );
  }
  return String(result.stdout || "").trim().toLowerCase();
}

function assertSafeRegularSourceFile(absolutePath, sourceFile) {
  let fileStat;
  try {
    fileStat = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_source_file_unavailable",
      "A declared repository source file is unavailable in the checked-out worktree.",
      { source_file: sourceFile, error: error.message },
    );
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_unsafe_source_file_type",
      "Repository authority source documents must be regular files and must not be symbolic links.",
      { source_file: sourceFile },
    );
  }
  if (fileStat.size > MAX_SOURCE_FILE_BYTES) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_source_file_too_large",
      "A repository authority source file exceeds the bounded maximum size.",
      { source_file: sourceFile, maximum_bytes: MAX_SOURCE_FILE_BYTES, observed_bytes: fileStat.size },
    );
  }
}

function parseSourceDocument(text, sourceFile) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_source_json",
      "A repository authority source file contains invalid JSON.",
      { source_file: sourceFile, error: error.message },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_source_document",
      "A repository authority source file must contain one JSON object.",
      { source_file: sourceFile },
    );
  }
  assertNoSensitiveValues(value, `source:${sourceFile}`);
  return value;
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_manifest",
      "A repository authority evidence manifest object is required.",
    );
  }
  assertNoSensitiveValues(manifest, "manifest");
  if (manifest.contract !== AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_manifest_contract",
      "The canonical repository authority evidence manifest contract is required.",
    );
  }
  if (!Array.isArray(manifest.sources)) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_invalid_manifest_sources",
      "manifest.sources must be an array.",
    );
  }
  const required = [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort();
  const sourceFamilies = manifest.sources.map((source, index) => token(
    source?.source_family,
    `manifest.sources[${index}].source_family`,
  ));
  const unique = [...new Set(sourceFamilies)].sort();
  const missing = required.filter((family) => !unique.includes(family));
  const extra = unique.filter((family) => !required.includes(family));
  if (sourceFamilies.length !== required.length || unique.length !== required.length || missing.length || extra.length) {
    throw new AuthorityEvidenceRepositorySnapshotError(
      "authority_evidence_repository_incomplete_family_manifest",
      "The repository manifest must bind exactly one source file for every registered authority family.",
      { missing_source_families: missing, extra_source_families: extra },
    );
  }
  return {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
    repository: token(manifest.repository, "manifest.repository"),
    observed_ref: commitSha(manifest.observed_ref, "manifest.observed_ref"),
    sources: manifest.sources.map((source, index) => ({
      source_family: sourceFamilies[index],
      source_file: safeRelativeFile(source.source_file, `manifest.sources[${index}].source_file`),
      blob_sha: commitSha(source.blob_sha, `manifest.sources[${index}].blob_sha`),
      content_sha256: digest(source.content_sha256, `manifest.sources[${index}].content_sha256`),
    })).sort((left, right) => left.source_family.localeCompare(right.source_family)),
  };
}

export function collectAuthorityEvidenceRepositorySnapshots({
  manifest,
  repository_root: repositoryRoot = process.cwd(),
  now = new Date(),
  read_file: readFile = (filePath) => fs.readFileSync(filePath, "utf8"),
  resolve_blob_sha: resolveBlobSha = defaultResolveBlobSha,
} = {}) {
  const normalizedManifest = normalizeManifest(manifest);
  const observedAt = timestamp(now, "now");
  const snapshots = [];
  const sourceFiles = [];

  for (const binding of normalizedManifest.sources) {
    const absolutePath = path.resolve(repositoryRoot, binding.source_file);
    const relativeBack = path.relative(path.resolve(repositoryRoot), absolutePath).replaceAll("\\", "/");
    if (relativeBack !== binding.source_file) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_source_path_escape",
        "The resolved source file escaped the repository root.",
        { source_file: binding.source_file },
      );
    }
    assertSafeRegularSourceFile(absolutePath, binding.source_file);

    const actualBlobSha = commitSha(
      resolveBlobSha(repositoryRoot, normalizedManifest.observed_ref, binding.source_file),
      `actual_blob_sha:${binding.source_file}`,
    );
    if (actualBlobSha !== binding.blob_sha) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_blob_mismatch",
        "The repository source blob does not match the reviewed manifest binding.",
        { source_file: binding.source_file, expected: binding.blob_sha, observed: actualBlobSha },
      );
    }

    const sourceText = String(readFile(absolutePath));
    const actualContentSha256 = sha256Text(sourceText);
    if (actualContentSha256 !== binding.content_sha256) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_content_hash_mismatch",
        "The repository source content does not match the reviewed manifest digest.",
        { source_file: binding.source_file },
      );
    }

    const document = parseSourceDocument(sourceText, binding.source_file);
    if (document.contract !== AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_invalid_source_contract",
        "A source file does not use the canonical repository source contract.",
        { source_file: binding.source_file },
      );
    }
    if (document.source_family !== binding.source_family) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_family_mismatch",
        "The source document family does not match its manifest binding.",
        { source_file: binding.source_file },
      );
    }
    if (!Array.isArray(document.records)) {
      throw new AuthorityEvidenceRepositorySnapshotError(
        "authority_evidence_repository_records_missing",
        "Each repository source document must contain a records array.",
        { source_file: binding.source_file },
      );
    }

    const evidenceRefs = Array.isArray(document.evidence_refs) ? [...document.evidence_refs] : [];
    evidenceRefs.push(`repository:${normalizedManifest.repository}/${binding.source_file}/${binding.blob_sha}`);
    const recordsSha256 = sha256Json(document.records);
    snapshots.push({
      source_family: binding.source_family,
      source_key: token(document.source_key, `${binding.source_file}.source_key`),
      source_identity: token(document.source_identity, `${binding.source_file}.source_identity`),
      observed_at: observedAt,
      pagination: {
        expected_count: document.records.length,
        observed_count: document.records.length,
        page_count: 1,
        complete: true,
        next_cursor: null,
      },
      evidence_refs: [...new Set(evidenceRefs)].sort(),
      content_sha256: recordsSha256,
      records: document.records,
      safety: {
        read_only: document.safety?.read_only,
        provider_calls: document.safety?.provider_calls,
        credential_payload_read: document.safety?.credential_payload_read,
        external_writes: document.safety?.external_writes,
        secrets_included: document.safety?.secrets_included,
      },
    });
    sourceFiles.push({
      source_family: binding.source_family,
      source_file: binding.source_file,
      blob_sha: binding.blob_sha,
      content_sha256: binding.content_sha256,
      records_sha256: recordsSha256,
      record_count: document.records.length,
    });
  }

  const bundle = buildAuthorityEvidenceSourceBundle({ sources: snapshots });
  const ready = bundle.status === "ready_for_ownership_review" && bundle.blocking_gap_count === 0;
  const unsigned = {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_ATTESTATION_CONTRACT,
    status: ready ? "ready_for_live_catalog_cycle" : "blocked",
    repository: normalizedManifest.repository,
    observed_ref: normalizedManifest.observed_ref,
    observed_at: observedAt,
    manifest_sha256: sha256Json(normalizedManifest),
    source_files: sourceFiles.sort((left, right) => left.source_family.localeCompare(right.source_family)),
    snapshots: snapshots.sort((left, right) => left.source_family.localeCompare(right.source_family)),
    bundle_sha256: bundle.bundle_sha256,
    inventory_sha256: bundle.inventory.inventory_sha256,
    blocking_gap_count: bundle.blocking_gap_count,
    gaps: bundle.gaps,
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  return Object.freeze({ ...unsigned, attestation_sha256: sha256Json(unsigned) });
}

export const _testingAuthorityEvidenceRepositorySnapshotCollector = Object.freeze({
  sha256Text,
  sha256Json,
  normalizeManifest,
  safeRelativeFile,
  assertNoSensitiveValues,
  assertSafeRegularSourceFile,
});
