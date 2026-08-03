import crypto from "node:crypto";

import { AUTHORITY_EVIDENCE_SOURCE_FAMILIES } from "./authorityEvidenceSourceAdapters.js";

export const AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-source.v1";
export const AUTHORITY_EVIDENCE_REPOSITORY_CANDIDATE_INDEX_CONTRACT =
  "mad4b.ueacp.authority-evidence-repository-candidate-index.v1";

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,220}$/;
const SENSITIVE_KEY_PATTERN =
  /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|auth(?:orization)?[_-]?header)/i;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_RECORDS = 8192;

export class AuthorityEvidenceRepositoryCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityEvidenceRepositoryCandidateError";
    this.code = code;
    this.details = details;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function renderJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return sha256Text(JSON.stringify(stable(value)));
}

function assertNoSensitiveValues(value, location = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && nested !== false && nested !== null) {
      throw new AuthorityEvidenceRepositoryCandidateError(
        "authority_evidence_repository_candidate_sensitive_value_forbidden",
        "Repository source candidates must not contain secret-bearing values.",
        { location: `${location}.${key}` },
      );
    }
    assertNoSensitiveValues(nested, `${location}.${key}`, seen);
  }
}

function token(value, field) {
  const normalized = String(value ?? "").trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_token",
      `${field} must be a bounded canonical token.`,
      { field },
    );
  }
  return normalized;
}

function commitSha(value, field) {
  const normalized = String(value ?? "").trim();
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_commit_sha",
      `${field} must be a lowercase full commit SHA.`,
      { field },
    );
  }
  return normalized;
}

function timestamp(value, field) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_timestamp",
      `${field} must be a valid timestamp.`,
      { field },
    );
  }
  return parsed.toISOString();
}

function repositoryName(value) {
  const normalized = String(value ?? "").trim();
  if (!REPOSITORY_PATTERN.test(normalized)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_repository",
      "repository must use owner/name form.",
    );
  }
  return normalized;
}

function safeRelativeDirectory(value) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/").replace(/\/$/, "");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_unsafe_output_directory",
      "source_directory must be a safe repository-relative directory.",
    );
  }
  return normalized;
}

function evidenceRefs(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_evidence_refs",
      `${field} must contain between one and 64 evidence references.`,
      { field },
    );
  }
  return [...new Set(value.map((item, index) => token(item, `${field}[${index}]`)))].sort();
}

function normalizePagination(value, recordCount, family) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_pagination_missing",
      "Every source snapshot must include pagination evidence.",
      { source_family: family },
    );
  }
  const expected = Number(value.expected_count);
  const observed = Number(value.observed_count);
  const pages = Number(value.page_count);
  if (
    value.complete !== true
    || !Number.isInteger(expected)
    || !Number.isInteger(observed)
    || !Number.isInteger(pages)
    || expected !== recordCount
    || observed !== recordCount
    || pages < 1
    || value.next_cursor !== null
  ) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_incomplete_pagination",
      "Source snapshot pagination must prove one complete bounded capture.",
      { source_family: family },
    );
  }
  return {
    expected_count: expected,
    observed_count: observed,
    page_count: pages,
    complete: true,
    next_cursor: null,
  };
}

function normalizeSafety(value, family) {
  const safe = value
    && value.read_only === true
    && value.provider_calls === false
    && value.credential_payload_read === false
    && value.external_writes === false
    && value.secrets_included === false;
  if (!safe) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_unsafe_snapshot",
      "Source snapshot safety markers must remain read-only and no-secret.",
      { source_family: family },
    );
  }
  return {
    read_only: true,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
}

function normalizeSnapshot(snapshot, family) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_snapshot",
      "Every source candidate must be built from one source snapshot object.",
      { source_family: family },
    );
  }
  assertNoSensitiveValues(snapshot, `snapshot:${family}`);
  if (String(snapshot.source_family || "").trim() !== family) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_family_mismatch",
      "Source snapshot family does not match its registered family.",
      { source_family: family },
    );
  }
  if (!Array.isArray(snapshot.records) || snapshot.records.length > MAX_SOURCE_RECORDS) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_invalid_records",
      "Source snapshot records must be an array within the fixed row bound.",
      { source_family: family, maximum: MAX_SOURCE_RECORDS },
    );
  }
  const records = stable(snapshot.records);
  assertNoSensitiveValues(records, `records:${family}`);
  const pagination = normalizePagination(snapshot.pagination, records.length, family);
  const safety = normalizeSafety(snapshot.safety, family);
  const observedAt = timestamp(snapshot.observed_at, `${family}.observed_at`);
  const document = {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
    source_family: family,
    source_key: token(snapshot.source_key, `${family}.source_key`),
    source_identity: token(snapshot.source_identity, `${family}.source_identity`),
    evidence_refs: evidenceRefs(snapshot.evidence_refs, `${family}.evidence_refs`),
    capture: {
      observed_at: observedAt,
      pagination,
      records_sha256: sha256Json(records),
    },
    records,
    safety,
  };
  const content = renderJson(document);
  if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_FILE_BYTES) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_source_file_too_large",
      "A rendered repository source candidate exceeds the 8 MiB source-file bound.",
      { source_family: family, maximum_bytes: MAX_SOURCE_FILE_BYTES },
    );
  }
  return {
    source_family: family,
    file_name: `${family}.json`,
    content,
    content_sha256: sha256Text(content),
    record_count: records.length,
    capture_observed_at: observedAt,
  };
}

export function buildAuthorityEvidenceRepositoryCandidates({
  snapshots,
  repository,
  observed_ref: observedRef,
  generated_at: generatedAt = new Date(),
  source_directory: sourceDirectory =
    "specs/011-unified-effective-authority-control-plane/evidence-sources",
} = {}) {
  if (!Array.isArray(snapshots)) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_snapshots_required",
      "An array of source snapshots is required.",
    );
  }
  assertNoSensitiveValues(snapshots, "snapshots");
  const required = [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort();
  const declared = snapshots.map((snapshot, index) => token(
    snapshot?.source_family,
    `snapshots[${index}].source_family`,
  ));
  const unique = [...new Set(declared)].sort();
  const missing = required.filter((family) => !unique.includes(family));
  const extra = unique.filter((family) => !required.includes(family));
  if (declared.length !== required.length || unique.length !== required.length || missing.length || extra.length) {
    throw new AuthorityEvidenceRepositoryCandidateError(
      "authority_evidence_repository_candidate_incomplete_family_set",
      "Exactly one snapshot for each registered authority family is required.",
      { missing_source_families: missing, extra_source_families: extra },
    );
  }

  const byFamily = new Map(snapshots.map((snapshot) => [snapshot.source_family, snapshot]));
  const documents = required.map((family) => normalizeSnapshot(byFamily.get(family), family));
  const normalizedSourceDirectory = safeRelativeDirectory(sourceDirectory);
  const normalizedRepository = repositoryName(repository);
  const normalizedObservedRef = commitSha(observedRef, "observed_ref");
  const normalizedGeneratedAt = timestamp(generatedAt, "generated_at");

  const unsignedIndex = {
    contract: AUTHORITY_EVIDENCE_REPOSITORY_CANDIDATE_INDEX_CONTRACT,
    repository: normalizedRepository,
    observed_ref: normalizedObservedRef,
    generated_at: normalizedGeneratedAt,
    source_document_contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
    source_directory: normalizedSourceDirectory,
    source_file_count: documents.length,
    source_files: documents.map((document) => ({
      source_family: document.source_family,
      source_file: `${normalizedSourceDirectory}/${document.file_name}`,
      content_sha256: document.content_sha256,
      record_count: document.record_count,
      capture_observed_at: document.capture_observed_at,
    })),
    manifest_status: "requires_post_commit_blob_binding",
    review_required: true,
    closes_t001: false,
    closes_t002: false,
    migration_apply_authorized: false,
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  const index = {
    ...unsignedIndex,
    candidate_index_sha256: sha256Json(unsignedIndex),
  };
  return { documents, index };
}

export const _testingAuthorityEvidenceRepositoryCandidateBuilder = Object.freeze({
  renderJson,
  sha256Text,
  safeRelativeDirectory,
});
