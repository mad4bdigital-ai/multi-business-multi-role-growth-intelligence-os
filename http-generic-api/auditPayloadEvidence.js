import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const DEFAULT_MAX_CHARS = 4000;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|set-cookie|secret|token|password|passphrase|api[_-]?key|private[_-]?key|credential|client[_-]?secret|refresh[_-]?token|access[_-]?token|bearer)/i;

export function sha256(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(String(value));
  }
}

export function redactAuditPayload(value, depth = 0) {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditPayload(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactAuditPayload(child, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    if (/^Bearer\s+/i.test(value)) return "[REDACTED]";
    if (value.length > 2000) return `${value.slice(0, 2000)}...[truncated]`;
  }
  return value;
}

export function boundedEvidencePayload(value, maxChars = DEFAULT_MAX_CHARS) {
  const rawJson = safeJsonStringify(value ?? null);
  const redacted = redactAuditPayload(value ?? null);
  const redactedJson = safeJsonStringify(redacted);
  const preview = redactedJson.length > maxChars ? `${redactedJson.slice(0, Math.max(0, maxChars - 15))}...[truncated]` : redactedJson;
  return {
    preview,
    raw_sha256: sha256(rawJson),
    redacted_sha256: sha256(redactedJson),
    raw_bytes: Buffer.byteLength(rawJson, "utf8"),
    preview_bytes: Buffer.byteLength(preview, "utf8"),
    truncated: redactedJson.length > maxChars,
    redaction_status: rawJson === redactedJson ? "not_required" : "redacted",
  };
}

export function buildAuditPayloadEvidence(input = {}) {
  const request = boundedEvidencePayload(input.request_payload ?? input.request ?? null, input.max_preview_chars || DEFAULT_MAX_CHARS);
  const response = boundedEvidencePayload(input.response_payload ?? input.response ?? null, input.max_preview_chars || DEFAULT_MAX_CHARS);
  return {
    evidence_id: input.evidence_id || randomUUID(),
    tenant_id: input.tenant_id || null,
    actor_id: input.actor_id || null,
    actor_type: input.actor_type || null,
    action: input.action || "audit.payload_evidence",
    resource_type: input.resource_type || null,
    resource_id: input.resource_id || null,
    source_table: input.source_table || null,
    source_pk: input.source_pk || null,
    evidence_type: input.evidence_type || "request_response",
    request_preview: request.preview,
    request_sha256: request.raw_sha256,
    response_preview: response.preview,
    response_sha256: response.raw_sha256,
    metadata_json: safeJsonStringify({
      ...(input.metadata || {}),
      request: {
        raw_bytes: request.raw_bytes,
        preview_bytes: request.preview_bytes,
        redacted_sha256: request.redacted_sha256,
        truncated: request.truncated,
        redaction_status: request.redaction_status,
      },
      response: {
        raw_bytes: response.raw_bytes,
        preview_bytes: response.preview_bytes,
        redacted_sha256: response.redacted_sha256,
        truncated: response.truncated,
        redaction_status: response.redaction_status,
      },
      policy: {
        max_preview_chars: input.max_preview_chars || DEFAULT_MAX_CHARS,
        secret_values_returned: false,
        token_returned: false,
      },
    }),
    redaction_status: request.redaction_status === "redacted" || response.redaction_status === "redacted" ? "redacted" : "not_required",
    secrets_included: false,
  };
}

export async function writeAuditPayloadEvidence(input = {}, { pool = getPool() } = {}) {
  const evidence = buildAuditPayloadEvidence(input);
  await pool.query(
    `INSERT INTO \`audit_payload_evidence\` (
       evidence_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id,
       source_table, source_pk, evidence_type, request_preview, request_sha256,
       response_preview, response_sha256, metadata_json, redaction_status, secrets_included
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      evidence.evidence_id,
      evidence.tenant_id,
      evidence.actor_id,
      evidence.actor_type,
      evidence.action,
      evidence.resource_type,
      evidence.resource_id,
      evidence.source_table,
      evidence.source_pk,
      evidence.evidence_type,
      evidence.request_preview,
      evidence.request_sha256,
      evidence.response_preview,
      evidence.response_sha256,
      evidence.metadata_json,
      evidence.redaction_status,
    ]
  );
  return evidence;
}
