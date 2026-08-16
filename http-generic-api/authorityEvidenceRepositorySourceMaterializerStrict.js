import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  buildAuthorityEvidenceSourceBundle,
} from "./authorityEvidenceSourceAdapters.js";

export const AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-source.v1";
export const AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-source-materialization.v1";
export const AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-manifest.v1";

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;

export class AuthorityEvidenceRepositorySourceMaterializationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityEvidenceRepositorySourceMaterializationError";
    this.code = code;
    this.details = details;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_token",
      `${field} must be a bounded canonical token.`,
      { field },
    );
  }
  return normalized;
}

function commitSha(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_commit",
      `${field} must be a lowercase full commit SHA.`,
      { field },
    );
  }
  return normalized;
}

function digest(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_digest",
      `${field} must be a lowercase SHA-256 digest.`,
      { field },
    );
  }
  return normalized;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_count",
      `${field} must be a non-negative safe integer.`,
      { field },
    );
  }
  return value;
}

function safeRelativePath(value, field, { directory = false } = {}) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/").replace(/\/$/, "");
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")
  ) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_unsafe_path",
      `${field} must be a safe repository-relative ${directory ? "directory" : "file"} path.`,
      { field },
    );
  }
  return normalized;
}

function sourceFileName(sourceFamily) {
  return `authority-evidence-source-${sourceFamily.replaceAll("_", "-")}.json`;
}

function assertReadyBundle(bundle) {
  if (bundle.status !== "ready_for_ownership_review" || bundle.blocking_gap_count !== 0) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_sources_not_ready",
      "Authority source snapshots must have zero blocking gaps before repository materialization.",
      {
        status: bundle.status,
        blocking_gap_count: bundle.blocking_gap_count,
        gaps: bundle.gaps,
      },
    );
  }
}

export function materializeAuthorityEvidenceRepositorySourceDocuments({
  sources,
  source_directory: sourceDirectory =
    "specs/011-unified-effective-authority-control-plane/authority-evidence-sources",
} = {}) {
  const normalizedDirectory = safeRelativePath(sourceDirectory, "source_directory", { directory: true });
  const bundle = buildAuthorityEvidenceSourceBundle({ sources });
  assertReadyBundle(bundle);

  const documents = bundle.sources.map((source) => {
    const sourceFile = `${normalizedDirectory}/${sourceFileName(source.source_family)}`;
    const document = {
      contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
      source_family: source.source_family,
      source_key: source.source_key,
      source_identity: source.source_identity,
      source_observed_at: source.observed_at,
      evidence_refs: source.evidence_refs,
      records: source.records,
      safety: {
        read_only: true,
        provider_calls: false,
        credential_payload_read: false,
        external_writes: false,
        secrets_included: false,
      },
    };
    const content = canonicalJson(document);
    return {
      source_family: source.source_family,
      source_file: sourceFile,
      record_count: source.records.length,
      records_sha256: source.content_sha256,
      content_sha256: sha256Text(content),
      content,
    };
  }).sort((left, right) => left.source_family.localeCompare(right.source_family));

  const unsignedReport = {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
    status: "ready_for_repository_review",
    source_directory: normalizedDirectory,
    source_document_count: documents.length,
    source_bundle_sha256: bundle.bundle_sha256,
    inventory_sha256: bundle.inventory.inventory_sha256,
    source_files: documents.map(({ content: _content, ...entry }) => entry),
    manifest_finalized: false,
    repository_mutation_performed: false,
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  const report = {
    ...unsignedReport,
    materialization_sha256: sha256Json(unsignedReport),
  };
  return deepFreeze({ documents, report, bundle });
}

function canonicalRepositoryRoot(repositoryRoot) {
  try {
    return fs.realpathSync(path.resolve(repositoryRoot));
  } catch (error) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_root_unavailable",
      "The repository root is unavailable.",
      { error: error.message },
    );
  }
}

function runGit(repositoryRoot, args, label) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_git_failure",
      `${label} failed.`,
      { args, stderr: String(result.stderr || "").trim().slice(-4000) },
    );
  }
  return String(result.stdout || "");
}

function resolveSafeRegularFile(repositoryRoot, sourceFile) {
  const absolutePath = path.resolve(repositoryRoot, sourceFile);
  const lexicalRelative = path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (lexicalRelative !== sourceFile) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_path_escape",
      "A source document escaped the repository root.",
      { source_file: sourceFile },
    );
  }
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_source_unavailable",
      "A source document is unavailable.",
      { source_file: sourceFile, error: error.message },
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_unsafe_file_type",
      "Source documents must be regular files and not symbolic links.",
      { source_file: sourceFile },
    );
  }
  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_source_too_large",
      "A source document exceeds the bounded maximum size.",
      { source_file: sourceFile, observed_bytes: stat.size, maximum_bytes: MAX_SOURCE_FILE_BYTES },
    );
  }
  const realPath = fs.realpathSync(absolutePath);
  const realRelative = path.relative(repositoryRoot, realPath).replaceAll("\\", "/");
  if (realRelative !== sourceFile) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_path_escape",
      "A source document real path differed from its reviewed repository path.",
      { source_file: sourceFile, observed_path: realRelative },
    );
  }
  return realPath;
}

function assertReportSafety(report) {
  const expected = {
    manifest_finalized: false,
    repository_mutation_performed: false,
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (report[field] !== expectedValue) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_invalid_report_safety",
        `materialization_report.${field} must equal ${String(expectedValue)}.`,
        { field, expected: expectedValue },
      );
    }
  }
}

function normalizeMaterializationReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_report",
      "A materialization report object is required.",
    );
  }
  if (report.contract !== AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_report_contract",
      "The canonical source materialization report contract is required.",
    );
  }
  if (report.status !== "ready_for_repository_review") {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_report_not_ready",
      "Only a ready source materialization report may be finalized.",
    );
  }
  assertReportSafety(report);

  const sourceDirectory = safeRelativePath(report.source_directory, "source_directory", { directory: true });
  const requiredFamilies = [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort();
  const sourceDocumentCount = nonNegativeInteger(report.source_document_count, "source_document_count");
  if (sourceDocumentCount !== requiredFamilies.length) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_source_count",
      "The materialization report source-document count must match the registered family count.",
      { observed: sourceDocumentCount, required: requiredFamilies.length },
    );
  }
  const sourceBundleSha256 = digest(report.source_bundle_sha256, "source_bundle_sha256");
  const inventorySha256 = digest(report.inventory_sha256, "inventory_sha256");
  const materializationSha256 = digest(report.materialization_sha256, "materialization_sha256");

  if (!Array.isArray(report.source_files)) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_source_files",
      "materialization_report.source_files must be an array.",
    );
  }
  const normalized = report.source_files.map((entry, index) => {
    const sourceFamily = token(entry?.source_family, `source_files[${index}].source_family`);
    const sourceFile = safeRelativePath(entry?.source_file, `source_files[${index}].source_file`);
    const expectedSourceFile = `${sourceDirectory}/${sourceFileName(sourceFamily)}`;
    if (sourceFile !== expectedSourceFile) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_noncanonical_source_path",
        "Every source document must use its canonical family path beneath source_directory.",
        { source_family: sourceFamily, source_file: sourceFile, expected_source_file: expectedSourceFile },
      );
    }
    return {
      source_family: sourceFamily,
      source_file: sourceFile,
      record_count: nonNegativeInteger(entry?.record_count, `source_files[${index}].record_count`),
      records_sha256: digest(entry?.records_sha256, `source_files[${index}].records_sha256`),
      content_sha256: digest(entry?.content_sha256, `source_files[${index}].content_sha256`),
    };
  }).sort((left, right) => left.source_family.localeCompare(right.source_family));
  const families = normalized.map((entry) => entry.source_family);
  const uniqueFamilies = [...new Set(families)].sort();
  const uniqueFiles = new Set(normalized.map((entry) => entry.source_file));
  if (
    normalized.length !== requiredFamilies.length
    || uniqueFamilies.length !== requiredFamilies.length
    || uniqueFiles.size !== requiredFamilies.length
    || JSON.stringify(uniqueFamilies) !== JSON.stringify(requiredFamilies)
  ) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_incomplete_report",
      "The materialization report must contain exactly one canonical source document for every registered family.",
      { observed_families: uniqueFamilies, required_families: requiredFamilies },
    );
  }

  const { materialization_sha256: _declaredDigest, ...unsignedReport } = report;
  const computedMaterializationSha256 = sha256Json(unsignedReport);
  if (computedMaterializationSha256 !== materializationSha256) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_report_digest_mismatch",
      "The materialization report no longer matches its canonical digest.",
      { declared: materializationSha256, computed: computedMaterializationSha256 },
    );
  }

  return {
    source_directory: sourceDirectory,
    source_document_count: sourceDocumentCount,
    source_bundle_sha256: sourceBundleSha256,
    inventory_sha256: inventorySha256,
    materialization_sha256: materializationSha256,
    source_files: normalized,
  };
}

function parseCanonicalSourceDocument(text, entry) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_invalid_source_json",
      "A source document contains invalid JSON.",
      { source_file: entry.source_file, error: error.message },
    );
  }
  if (
    document?.contract !== AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT
    || document?.source_family !== entry.source_family
  ) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_source_contract_mismatch",
      "A source document contract or family differs from its reviewed report entry.",
      { source_file: entry.source_file },
    );
  }
  if (!Array.isArray(document.records) || document.records.length !== entry.record_count) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_source_record_count_mismatch",
      "A source document record count differs from its reviewed report entry.",
      { source_file: entry.source_file, expected: entry.record_count },
    );
  }
  return document;
}

function reconstructReviewedSourceBundle(documents, normalizedReport) {
  const sources = documents.map(({ document, entry }) => ({
    source_family: document.source_family,
    source_key: document.source_key,
    source_identity: document.source_identity,
    observed_at: document.source_observed_at,
    pagination: {
      expected_count: entry.record_count,
      observed_count: entry.record_count,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
    evidence_refs: document.evidence_refs,
    records: document.records,
    safety: document.safety,
    content_sha256: entry.records_sha256,
  }));
  const bundle = buildAuthorityEvidenceSourceBundle({ sources });
  assertReadyBundle(bundle);
  if (bundle.bundle_sha256 !== normalizedReport.source_bundle_sha256) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_source_bundle_mismatch",
      "The reviewed source documents no longer reproduce the materialized source bundle.",
      { declared: normalizedReport.source_bundle_sha256, computed: bundle.bundle_sha256 },
    );
  }
  if (bundle.inventory.inventory_sha256 !== normalizedReport.inventory_sha256) {
    throw new AuthorityEvidenceRepositorySourceMaterializationError(
      "authority_evidence_repository_materialization_inventory_mismatch",
      "The reviewed source documents no longer reproduce the materialized authority inventory.",
      { declared: normalizedReport.inventory_sha256, computed: bundle.inventory.inventory_sha256 },
    );
  }
  return bundle;
}

export function finalizeAuthorityEvidenceRepositoryManifest({
  materialization_report: materializationReport,
  repository,
  observed_ref: observedRef,
  repository_root: repositoryRoot = process.cwd(),
} = {}) {
  const normalizedRepository = token(repository, "repository");
  const normalizedObservedRef = commitSha(observedRef, "observed_ref");
  const normalizedReport = normalizeMaterializationReport(materializationReport);
  const sourceFiles = normalizedReport.source_files;
  const root = canonicalRepositoryRoot(repositoryRoot);

  runGit(root, ["cat-file", "-e", `${normalizedObservedRef}^{commit}`], "Observed ref validation");
  runGit(root, ["merge-base", "--is-ancestor", normalizedObservedRef, "HEAD"], "Observed ref ancestry validation");

  const reviewedDocuments = [];
  const bindings = sourceFiles.map((entry) => {
    const sourcePath = resolveSafeRegularFile(root, entry.source_file);
    const currentText = fs.readFileSync(sourcePath, "utf8");
    const currentContentSha256 = sha256Text(currentText);
    if (currentContentSha256 !== entry.content_sha256) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_current_content_mismatch",
        "A source document no longer matches the reviewed materialization report.",
        { source_file: entry.source_file },
      );
    }

    parseCanonicalSourceDocument(currentText, entry);
    const reviewedText = runGit(
      root,
      ["show", `${normalizedObservedRef}:${entry.source_file}`],
      `Reviewed source read for ${entry.source_file}`,
    );
    if (sha256Text(reviewedText) !== currentContentSha256) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_reviewed_content_mismatch",
        "The current source document differs from the bytes committed at the reviewed ref.",
        { source_file: entry.source_file },
      );
    }
    const reviewedDocument = parseCanonicalSourceDocument(reviewedText, entry);
    reviewedDocuments.push({ document: reviewedDocument, entry });

    const blobSha = commitSha(
      runGit(root, ["rev-parse", `${normalizedObservedRef}:${entry.source_file}`], `Blob resolution for ${entry.source_file}`).trim(),
      `blob_sha:${entry.source_file}`,
    );
    return {
      source_family: entry.source_family,
      source_file: entry.source_file,
      blob_sha: blobSha,
      content_sha256: currentContentSha256,
    };
  }).sort((left, right) => left.source_family.localeCompare(right.source_family));

  reconstructReviewedSourceBundle(reviewedDocuments, normalizedReport);

  const manifest = {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
    repository: normalizedRepository,
    observed_ref: normalizedObservedRef,
    sources: bindings,
  };
  return deepFreeze({
    manifest,
    manifest_sha256: sha256Json(manifest),
    materialization_sha256: normalizedReport.materialization_sha256,
    source_bundle_sha256: normalizedReport.source_bundle_sha256,
    inventory_sha256: normalizedReport.inventory_sha256,
    source_document_count: bindings.length,
    repository_mutation_performed: false,
    secrets_included: false,
  });
}
