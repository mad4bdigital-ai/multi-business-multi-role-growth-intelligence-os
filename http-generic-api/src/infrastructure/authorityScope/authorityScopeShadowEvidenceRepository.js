import { randomUUID } from "node:crypto";

function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError("Authority Scope shadow evidence repository requires a SQL pool with execute().");
  }
  return pool;
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requiredString(value, name) {
  const normalized = cleanString(value);
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(["serialization_failed"]);
  }
}

function normalizeEvidence(input = {}) {
  const shadow = input.authorityScopeShadow || {};
  const scope = shadow.scope || {};
  const principal = input.principal || {};

  return Object.freeze({
    evidenceId: cleanString(input.evidenceId) || randomUUID(),
    tenantId: requiredString(input.tenantId, "tenantId"),
    requestId: cleanString(input.requestId),
    resolutionId: requiredString(input.resolutionId, "resolutionId"),
    principalType: requiredString(principal.type, "principal.type"),
    principalId: requiredString(principal.id, "principal.id"),
    targetContainerId: requiredString(input.targetContainerId, "targetContainerId"),
    scopeId: cleanString(scope.scopeId),
    scopeKey: cleanString(scope.scopeKey),
    scopeType: cleanString(scope.scopeType),
    scopeTenantId: cleanString(scope.tenantId),
    status: shadow.status === "resolved" ? "resolved" : "unresolved",
    comparisonStatus: ["match", "mismatch"].includes(shadow.comparisonStatus)
      ? shadow.comparisonStatus
      : "unresolved",
    mismatchCodesJson: safeJson(Array.isArray(shadow.mismatchCodes) ? shadow.mismatchCodes : []),
    enforcementMode: "shadow_only",
    authorityGranted: 0,
    providerCallMade: 0,
    credentialPayloadRead: 0,
    secretsIncluded: 0,
    durationMs: Number.isFinite(Number(shadow.durationMs)) ? Number(shadow.durationMs) : null,
    errorCode: cleanString(shadow.error?.code),
    errorStatus: Number.isFinite(Number(shadow.error?.status)) ? Number(shadow.error.status) : null
  });
}

export function createAuthorityScopeShadowEvidenceRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError("Authority Scope shadow evidence repository requires resolvePool().");
  }

  async function insert(input) {
    const row = normalizeEvidence(input);
    const pool = requirePool(await resolvePool());
    await pool.execute(
      `INSERT INTO authority_scope_shadow_evidence (
        evidence_id,tenant_id,request_id,resolution_id,principal_type,principal_id,target_container_id,
        scope_id,scope_key,scope_type,scope_tenant_id,status,comparison_status,mismatch_codes_json,
        enforcement_mode,authority_granted,provider_call_made,credential_payload_read,secrets_included,
        duration_ms,error_code,error_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.evidenceId,
        row.tenantId,
        row.requestId,
        row.resolutionId,
        row.principalType,
        row.principalId,
        row.targetContainerId,
        row.scopeId,
        row.scopeKey,
        row.scopeType,
        row.scopeTenantId,
        row.status,
        row.comparisonStatus,
        row.mismatchCodesJson,
        row.enforcementMode,
        row.authorityGranted,
        row.providerCallMade,
        row.credentialPayloadRead,
        row.secretsIncluded,
        row.durationMs,
        row.errorCode,
        row.errorStatus
      ]
    );
    return Object.freeze({
      evidenceId: row.evidenceId,
      status: "persisted",
      comparisonStatus: row.comparisonStatus
    });
  }

  return Object.freeze({ insert });
}

export const _testingAuthorityScopeShadowEvidenceRepository = Object.freeze({
  normalizeEvidence,
  safeJson
});
