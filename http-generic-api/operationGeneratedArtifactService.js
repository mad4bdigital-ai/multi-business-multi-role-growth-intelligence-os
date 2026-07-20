import { createHash, randomUUID } from "node:crypto";
import { extractOperationRunId } from "./operationRunOwnershipService.js";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const MAX_ARTIFACTS_PER_RESULT = 100;
const MAX_LIMIT = 100;
const METADATA_FIELDS = Object.freeze([
  "name", "label", "source_tool_key", "step_key", "status",
  "repository", "branch", "commit_sha", "pull_number",
]);

function artifactError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function principalClass(auth = {}) {
  const mode = compact(auth.mode || auth.caller_type, 64).toLowerCase();
  if (auth.is_admin === true || ADMIN_MODES.has(mode)) return "admin";
  if (mode === "user_jwt" && auth.tenant_id && auth.user_id) return "tenant";
  return null;
}

function normalizeSha256(value) {
  const candidate = compact(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
}

function normalizeSize(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeUri(value) {
  const uri = compact(value, 1000);
  if (!uri || /^data:/i.test(uri) || /[\r\n]/.test(uri)) return null;
  try {
    if (/^https?:\/\//i.test(uri)) {
      const parsed = new URL(uri);
      if (parsed.username || parsed.password) return null;
    }
  } catch {
    return null;
  }
  return uri;
}

function safeMetadata(candidate = {}) {
  const metadata = {};
  for (const field of METADATA_FIELDS) {
    const value = candidate[field];
    if (value === null || value === undefined || value === "") continue;
    if (field === "pull_number") {
      const number = Number(value);
      if (Number.isInteger(number) && number > 0) metadata[field] = number;
      continue;
    }
    metadata[field] = compact(value, field === "name" || field === "label" ? 255 : 500);
  }
  return metadata;
}

function candidateRoots(result = {}) {
  return [
    result.generated_artifacts,
    result.artifacts,
    result.artifact_refs,
    result.outputs?.artifacts,
    result.result?.generated_artifacts,
    result.result?.artifacts,
    result.result?.artifact_refs,
    result.body?.generated_artifacts,
    result.body?.artifacts,
    result.body?.artifact_refs,
  ];
}

function flattenCandidates(value, out) {
  if (out.length >= MAX_ARTIFACTS_PER_RESULT || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) flattenCandidates(item, out);
    return;
  }
  out.push(value);
}

function normalizeArtifactCandidate(candidate) {
  if (typeof candidate === "string") {
    const artifactUri = safeUri(candidate);
    if (!artifactUri) return null;
    return {
      artifact_type: "reference",
      artifact_uri: artifactUri,
      mime_type: null,
      checksum_sha256: null,
      size_bytes: null,
      redaction_status: "unknown",
      status: "registered",
      metadata: {},
    };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if (candidate.secrets_included === true) return null;

  const artifactUri = safeUri(
    candidate.artifact_uri || candidate.uri || candidate.ref || candidate.url
      || candidate.path || candidate.storage_ref || candidate.download_url,
  );
  if (!artifactUri) return null;

  const redaction = compact(candidate.redaction_status || candidate.redaction, 32).toLowerCase();
  const candidateStatus = compact(candidate.status, 32).toLowerCase();
  return {
    artifact_type: compact(candidate.artifact_type || candidate.type || candidate.kind || "reference", 64) || "reference",
    artifact_uri: artifactUri,
    mime_type: compact(candidate.mime_type || candidate.media_type, 191) || null,
    checksum_sha256: normalizeSha256(
      candidate.checksum_sha256 || candidate.sha256 || candidate.content_sha256 || candidate.hash,
    ),
    size_bytes: normalizeSize(candidate.size_bytes ?? candidate.byte_size ?? candidate.bytes),
    redaction_status: ["redacted", "non_secret"].includes(redaction) ? redaction : "unknown",
    status: ["registered", "unavailable", "invalid"].includes(candidateStatus) ? candidateStatus : "registered",
    metadata: safeMetadata(candidate),
  };
}

export function extractGeneratedArtifacts(result = {}) {
  const flattened = [];
  for (const root of candidateRoots(result)) flattenCandidates(root, flattened);
  const normalized = [];
  const seen = new Set();
  for (const candidate of flattened.slice(0, MAX_ARTIFACTS_PER_RESULT)) {
    const artifact = normalizeArtifactCandidate(candidate);
    if (!artifact) continue;
    const key = `${artifact.artifact_type}\n${artifact.artifact_uri}\n${artifact.checksum_sha256 || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(artifact);
  }
  return normalized;
}

function artifactKeySha256(runId, artifact) {
  return createHash("sha256")
    .update(JSON.stringify({
      run_id: runId,
      artifact_type: artifact.artifact_type,
      artifact_uri: artifact.artifact_uri,
      checksum_sha256: artifact.checksum_sha256,
    }))
    .digest("hex");
}

function encodeCursor(runId, artifactId) {
  return Buffer.from(JSON.stringify({ v: 1, run_id: runId, after: artifactId }), "utf8").toString("base64url");
}

function decodeCursor(runId, value) {
  const cursor = compact(value, 1000);
  if (!cursor) return "";
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed?.v !== 1 || parsed?.run_id !== runId || typeof parsed?.after !== "string") throw new Error("invalid");
    return parsed.after;
  } catch {
    throw artifactError(400, "OPERATION_ARTIFACT_CURSOR_INVALID", "The artifact cursor is invalid.", { run_id: runId });
  }
}

function positiveLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function publicArtifact(row = {}) {
  let metadata = {};
  try {
    metadata = typeof row.metadata_json === "object" && row.metadata_json
      ? row.metadata_json
      : JSON.parse(row.metadata_json || "{}");
  } catch {}
  return {
    artifact_id: row.artifact_id,
    run_id: row.run_id,
    operation_key: row.operation_key || null,
    artifact_type: row.artifact_type,
    artifact_uri: row.artifact_uri,
    mime_type: row.mime_type || null,
    checksum_sha256: row.checksum_sha256 || null,
    size_bytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    redaction_status: row.redaction_status,
    status: row.status,
    metadata,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    secrets_included: false,
  };
}

async function query(pool, sql, params) {
  if (!pool || typeof pool.query !== "function") {
    throw artifactError(500, "OPERATION_ARTIFACT_POOL_REQUIRED", "Artifact registry access requires a database pool.");
  }
  try {
    return await pool.query(sql, params);
  } catch (cause) {
    throw artifactError(503, "OPERATION_ARTIFACT_REGISTRY_UNAVAILABLE", "The generated artifact registry is unavailable.", {
      cause_code: cause?.code || null,
      retryable: true,
    });
  }
}

export async function recordOperationGeneratedArtifacts({
  pool, auth = {}, input = {}, result = {}, operationKey = null,
} = {}) {
  const runId = extractOperationRunId(result);
  const artifacts = extractGeneratedArtifacts(result);
  if (!runId || !artifacts.length) {
    return {
      recorded: false,
      run_id: runId,
      artifact_count: 0,
      reason: runId ? "no_explicit_generated_artifacts" : "run_id_missing",
      secrets_included: false,
    };
  }

  const scope = principalClass(auth);
  if (!scope) {
    throw artifactError(403, "OPERATION_ARTIFACT_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  }
  const tenantId = scope === "tenant" ? compact(auth.tenant_id, 36) : null;
  const userId = scope === "tenant" ? compact(auth.user_id, 36) : null;
  const workspaceId = compact(input.workspace_id || input.workspaceId, 36) || null;
  const resolvedOperationKey = compact(
    operationKey || input.operation_key || input.operation || input.intent, 128,
  ) || null;

  for (const artifact of artifacts) {
    const keySha = artifactKeySha256(runId, artifact);
    await query(
      pool,
      `INSERT INTO operation_generated_artifacts (
         artifact_id, artifact_key_sha256, run_id, principal_scope,
         tenant_id, workspace_id, user_id, operation_key,
         artifact_type, artifact_uri, mime_type, checksum_sha256, size_bytes,
         redaction_status, metadata_json, status, secrets_included
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         mime_type = COALESCE(VALUES(mime_type), mime_type),
         checksum_sha256 = COALESCE(VALUES(checksum_sha256), checksum_sha256),
         size_bytes = COALESCE(VALUES(size_bytes), size_bytes),
         redaction_status = VALUES(redaction_status),
         metadata_json = VALUES(metadata_json),
         status = VALUES(status),
         updated_at = CURRENT_TIMESTAMP`,
      [
        randomUUID(), keySha, runId, scope, tenantId, workspaceId, userId,
        resolvedOperationKey, artifact.artifact_type, artifact.artifact_uri,
        artifact.mime_type, artifact.checksum_sha256, artifact.size_bytes,
        artifact.redaction_status, JSON.stringify(artifact.metadata), artifact.status,
      ],
    );
  }

  const [rows] = await query(
    pool,
    `SELECT artifact_id, run_id, operation_key, artifact_type, artifact_uri,
            mime_type, checksum_sha256, size_bytes, redaction_status,
            metadata_json, status, created_at, updated_at
       FROM operation_generated_artifacts
      WHERE run_id = ?
      ORDER BY artifact_id ASC`,
    [runId],
  );
  return {
    recorded: true,
    run_id: runId,
    artifact_count: rows.length,
    items: rows.map(publicArtifact),
    secrets_included: false,
  };
}

export async function listOperationGeneratedArtifacts(input = {}, deps = {}) {
  const runId = compact(input.run_id || input.runId, 36);
  if (!runId) throw artifactError(400, "OPERATION_ARTIFACT_RUN_ID_REQUIRED", "run_id is required.");
  const scope = principalClass(deps.auth || {});
  if (!scope) {
    throw artifactError(403, "OPERATION_ARTIFACT_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  }

  const limit = positiveLimit(input.limit);
  const after = decodeCursor(runId, input.cursor);
  const artifactType = compact(input.artifact_type, 64);
  const params = [runId, after];
  let tenantClause = "";
  if (scope === "tenant") {
    tenantClause = "AND tenant_id = ? AND user_id = ?";
    params.push(compact(deps.auth.tenant_id, 36), compact(deps.auth.user_id, 36));
  }
  let typeClause = "";
  if (artifactType) {
    typeClause = "AND artifact_type = ?";
    params.push(artifactType);
  }
  params.push(limit + 1);

  const [rows] = await query(
    deps.pool,
    `SELECT artifact_id, run_id, operation_key, artifact_type, artifact_uri,
            mime_type, checksum_sha256, size_bytes, redaction_status,
            metadata_json, status, created_at, updated_at
       FROM operation_generated_artifacts
      WHERE run_id = ?
        AND artifact_id > ?
        ${tenantClause}
        ${typeClause}
      ORDER BY artifact_id ASC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(publicArtifact);
  return {
    ok: true,
    run_id: runId,
    principal_scope: scope,
    filters: { artifact_type: artifactType || null },
    items,
    page: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && items.length ? encodeCursor(runId, items.at(-1).artifact_id) : null,
    },
    completeness: "complete",
    secrets_included: false,
  };
}

export const _testingOperationGeneratedArtifactService = {
  principalClass,
  normalizeSha256,
  normalizeSize,
  safeUri,
  safeMetadata,
  normalizeArtifactCandidate,
  artifactKeySha256,
  encodeCursor,
  decodeCursor,
  publicArtifact,
};
