import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildAuthorityEvidenceSourceBundle } from "./authorityEvidenceSourceAdapters.js";
import {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
  AuthorityEvidenceRepositorySourceMaterializationError,
  finalizeAuthorityEvidenceRepositoryManifest as finalizeStrictManifest,
  materializeAuthorityEvidenceRepositorySourceDocuments as materializeStrictDocuments,
} from "./authorityEvidenceRepositorySourceMaterializerStrict.js";

export {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
  AuthorityEvidenceRepositorySourceMaterializationError,
};

const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function canonicalPagination(pagination) {
  return {
    expected_count: pagination.expected_count,
    observed_count: pagination.observed_count,
    page_count: pagination.page_count,
    complete: pagination.complete,
    next_cursor: pagination.next_cursor,
  };
}

export function materializeAuthorityEvidenceRepositorySourceDocuments(options = {}) {
  const strict = materializeStrictDocuments(options);
  const sourceDirectory = strict.report.source_directory;
  const documents = strict.bundle.sources.map((source) => {
    const sourceFile = `${sourceDirectory}/authority-evidence-source-${source.source_family.replaceAll("_", "-")}.json`;
    const document = {
      contract: AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
      source_family: source.source_family,
      source_key: source.source_key,
      source_identity: source.source_identity,
      source_observed_at: source.observed_at,
      pagination: canonicalPagination(source.pagination),
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
    source_directory: sourceDirectory,
    source_document_count: documents.length,
    source_bundle_sha256: strict.bundle.bundle_sha256,
    inventory_sha256: strict.bundle.inventory.inventory_sha256,
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
  return deepFreeze({ documents, report, bundle: strict.bundle });
}

function resolveRepositoryRoot(value) {
  return fs.realpathSync(path.resolve(value));
}

function safeSourcePath(root, sourceFile) {
  const normalized = String(sourceFile ?? "").trim().replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")
  ) {
    throw new Error("unsafe source path");
  }
  const absolutePath = path.resolve(root, normalized);
  if (path.relative(root, absolutePath).replaceAll("\\", "/") !== normalized) {
    throw new Error("source path escaped repository root");
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error("unsafe source file");
  }
  const realPath = fs.realpathSync(absolutePath);
  if (path.relative(root, realPath).replaceAll("\\", "/") !== normalized) {
    throw new Error("source real path escaped repository root");
  }
  return realPath;
}

function sourceFromDocument(document, entry) {
  return {
    source_family: document.source_family,
    source_key: document.source_key,
    source_identity: document.source_identity,
    observed_at: document.source_observed_at,
    pagination: document.pagination,
    evidence_refs: document.evidence_refs,
    records: document.records,
    safety: document.safety,
    content_sha256: entry.records_sha256,
  };
}

function readCanonicalContext(materializationReport, root) {
  if (!Array.isArray(materializationReport?.source_files)) {
    throw new Error("source_files unavailable");
  }
  const documents = materializationReport.source_files.map((entry) => {
    const sourceFile = String(entry?.source_file ?? "").trim().replaceAll("\\", "/");
    const sourcePath = safeSourcePath(root, sourceFile);
    const text = fs.readFileSync(sourcePath, "utf8");
    const document = JSON.parse(text);
    return {
      entry,
      source_file: sourceFile,
      text,
      document,
      source: sourceFromDocument(document, entry),
    };
  });
  return { documents, sources: documents.map((entry) => entry.source) };
}

function compatibilityReport(materializationReport, sources) {
  const compatibilitySources = sources.map((source) => ({
    ...source,
    pagination: {
      expected_count: source.records.length,
      observed_count: source.records.length,
      page_count: 1,
      complete: true,
      next_cursor: null,
    },
  }));
  const compatibilityBundle = buildAuthorityEvidenceSourceBundle({ sources: compatibilitySources });
  const {
    materialization_sha256: _declaredMaterializationSha256,
    ...unsignedCompatibilityReport
  } = {
    ...materializationReport,
    source_bundle_sha256: compatibilityBundle.bundle_sha256,
    inventory_sha256: compatibilityBundle.inventory.inventory_sha256,
  };
  return {
    ...unsignedCompatibilityReport,
    materialization_sha256: sha256Json(unsignedCompatibilityReport),
  };
}

function prepareCompatibility(options) {
  try {
    const root = resolveRepositoryRoot(options.repository_root ?? process.cwd());
    const context = readCanonicalContext(options.materialization_report, root);
    return {
      root,
      context,
      report: compatibilityReport(options.materialization_report, context.sources),
    };
  } catch {
    return null;
  }
}

function canonicalFailure(code, message, details = {}) {
  return new AuthorityEvidenceRepositorySourceMaterializationError(code, message, details);
}

function assertCanonicalRoundTrip({ materializationReport, context }) {
  let canonical;
  try {
    canonical = materializeAuthorityEvidenceRepositorySourceDocuments({
      sources: context.sources,
      source_directory: materializationReport.source_directory,
    });
  } catch (error) {
    throw canonicalFailure(
      "authority_evidence_repository_materialization_canonical_replay_failed",
      "The reviewed source documents could not be replayed through the canonical materializer.",
      { cause_code: error?.code || error?.name || "unknown" },
    );
  }

  if (stableJson(materializationReport) !== stableJson(canonical.report)) {
    throw canonicalFailure(
      "authority_evidence_repository_materialization_noncanonical_report",
      "The materialization report is not the exact canonical report reproduced from the reviewed source documents.",
      {
        declared_materialization_sha256: materializationReport?.materialization_sha256 ?? null,
        canonical_materialization_sha256: canonical.report.materialization_sha256,
      },
    );
  }

  const canonicalByFile = new Map(canonical.documents.map((document) => [document.source_file, document]));
  for (const reviewed of context.documents) {
    const canonicalDocument = canonicalByFile.get(reviewed.source_file);
    if (!canonicalDocument || reviewed.text !== canonicalDocument.content) {
      throw canonicalFailure(
        "authority_evidence_repository_materialization_noncanonical_source_document",
        "A reviewed source document is not the exact canonical JSON emitted by the materializer.",
        { source_file: reviewed.source_file },
      );
    }
  }
  return canonical;
}

export function finalizeAuthorityEvidenceRepositoryManifest(options = {}) {
  const prepared = prepareCompatibility(options);
  const strictResult = finalizeStrictManifest({
    ...options,
    materialization_report: prepared?.report ?? options.materialization_report,
  });

  let root = prepared?.root;
  let context = prepared?.context;
  if (!root || !context) {
    try {
      root = resolveRepositoryRoot(options.repository_root ?? process.cwd());
      context = readCanonicalContext(options.materialization_report, root);
    } catch (error) {
      throw canonicalFailure(
        "authority_evidence_repository_materialization_canonical_context_unavailable",
        "The canonical reviewed-source context is unavailable after strict validation.",
        { cause: error?.message || String(error) },
      );
    }
  }

  const canonical = assertCanonicalRoundTrip({
    materializationReport: options.materialization_report,
    context,
  });

  return deepFreeze({
    ...strictResult,
    materialization_sha256: canonical.report.materialization_sha256,
    source_bundle_sha256: canonical.report.source_bundle_sha256,
    inventory_sha256: canonical.report.inventory_sha256,
  });
}
