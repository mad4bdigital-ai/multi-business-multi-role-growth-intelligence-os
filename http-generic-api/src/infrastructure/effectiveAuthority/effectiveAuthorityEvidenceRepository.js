import { createHash, randomUUID } from "node:crypto";
import { assertNoSecretEvidence } from "../../domain/effectiveAuthority/effectiveAuthority.js";

function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError("Effective authority evidence repository requires a SQL pool with execute().");
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value, name, maximumBytes = 131072) {
  assertNoSecretEvidence(value);
  const json = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(json, "utf8") > maximumBytes) {
    const error = new Error(`${name} exceeds the bounded evidence size.`);
    error.code = "AUTHORITY_EVIDENCE_TOO_LARGE";
    throw error;
  }
  return json;
}

function mysqlDate(value, name) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${name} must be a valid timestamp.`);
  return parsed.toISOString().replace("T", " ").replace("Z", "");
}

function normalizeDecisionEvidence({ manifest, persistenceMode, evidenceSource = "ueacp_runtime" }) {
  assertNoSecretEvidence(manifest);
  const manifestJson = canonicalJson(manifest, "manifest");
  const manifestSha256 = createHash("sha256").update(manifestJson, "utf8").digest("hex");
  const principal = manifest?.principal || {};
  const subjectScope = manifest?.subjectScope || {};
  const capability = manifest?.capability || {};
  const resource = manifest?.resource || {};

  return Object.freeze({
    decisionId: requiredString(manifest?.decisionId, "manifest.decisionId"),
    tenantId: cleanString(subjectScope.tenantId),
    principalType: requiredString(principal.principalType, "manifest.principal.principalType"),
    principalId: requiredString(principal.principalId, "manifest.principal.principalId"),
    subjectScopeId: cleanString(subjectScope.scopeId),
    subjectScopeKey: requiredString(subjectScope.scopeKey, "manifest.subjectScope.scopeKey"),
    subjectScopeType: requiredString(subjectScope.scopeType, "manifest.subjectScope.scopeType"),
    subjectTenantId: cleanString(subjectScope.tenantId),
    capabilityKey: requiredString(capability.key, "manifest.capability.key"),
    resourceType: requiredString(resource.type, "manifest.resource.type"),
    resourceKey: requiredString(resource.key, "manifest.resource.key"),
    decision: requiredString(manifest.decision, "manifest.decision"),
    enforcementMode: "shadow_only",
    authorityGranted: 0,
    manifestSha256,
    manifestJson,
    readinessJson: canonicalJson(manifest.readiness || {}, "readiness"),
    projectionEligibilityJson: canonicalJson(
      manifest.projectionEligibility || {},
      "projectionEligibility"
    ),
    gapsJson: canonicalJson(Array.isArray(manifest.gaps) ? manifest.gaps : [], "gaps"),
    versionsJson: canonicalJson(manifest.versions || {}, "versions"),
    providerCallMade: 0,
    credentialPayloadRead: 0,
    externalWriteMade: 0,
    secretsIncluded: 0,
    evidenceSource: requiredString(evidenceSource, "evidenceSource"),
    persistenceMode: requiredString(persistenceMode, "persistenceMode"),
    evaluatedAt: mysqlDate(manifest.evaluatedAt, "manifest.evaluatedAt"),
    expiresAt: mysqlDate(manifest.expiresAt, "manifest.expiresAt"),
  });
}

function normalizeDriftEvidence({
  decisionId,
  tenantId = null,
  projectionConsistency,
  issueCode,
  detectedAt,
  driftEventId = null,
}) {
  const counts = projectionConsistency?.counts || {};
  const details = {
    projectionKey: projectionConsistency?.projectionKey,
    status: projectionConsistency?.status,
    issueCodes: projectionConsistency?.issueCodes || [],
    counts,
    enforcementMode: "shadow_only",
    authorityGranted: false,
    secretsIncluded: false,
  };
  return Object.freeze({
    driftEventId: cleanString(driftEventId) || randomUUID(),
    decisionId: requiredString(decisionId, "decisionId"),
    tenantId: cleanString(tenantId),
    projectionKey: requiredString(
      projectionConsistency?.projectionKey,
      "projectionConsistency.projectionKey"
    ),
    issueCode: requiredString(issueCode, "issueCode"),
    registeredCount: Number(counts.registeredCount || 0),
    authorizedCount: Number(counts.authorizedCount || 0),
    projectedCount: Number(counts.projectedCount || 0),
    executableCandidateCount: Number(counts.executableCandidateCount || 0),
    detailsJson: canonicalJson(details, "projection drift details"),
    status: "open",
    enforcementMode: "shadow_only",
    authorityGranted: 0,
    providerCallMade: 0,
    credentialPayloadRead: 0,
    externalWriteMade: 0,
    secretsIncluded: 0,
    detectedAt: mysqlDate(detectedAt, "detectedAt"),
  });
}

export function createEffectiveAuthorityEvidenceRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") {
    throw new TypeError("Effective authority evidence repository requires resolvePool().");
  }

  async function insertDecision(input) {
    const row = normalizeDecisionEvidence(input);
    const pool = requirePool(await resolvePool());
    await pool.execute(
      `INSERT INTO effective_authority_shadow_decisions (
        decision_id,tenant_id,principal_type,principal_id,subject_scope_id,subject_scope_key,
        subject_scope_type,subject_tenant_id,capability_key,resource_type,resource_key,decision,
        enforcement_mode,authority_granted,manifest_sha256,manifest_json,readiness_json,
        projection_eligibility_json,gaps_json,versions_json,provider_call_made,
        credential_payload_read,external_write_made,secrets_included,evidence_source,
        persistence_mode,evaluated_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE decision_id = VALUES(decision_id)`,
      [
        row.decisionId,
        row.tenantId,
        row.principalType,
        row.principalId,
        row.subjectScopeId,
        row.subjectScopeKey,
        row.subjectScopeType,
        row.subjectTenantId,
        row.capabilityKey,
        row.resourceType,
        row.resourceKey,
        row.decision,
        row.enforcementMode,
        row.authorityGranted,
        row.manifestSha256,
        row.manifestJson,
        row.readinessJson,
        row.projectionEligibilityJson,
        row.gapsJson,
        row.versionsJson,
        row.providerCallMade,
        row.credentialPayloadRead,
        row.externalWriteMade,
        row.secretsIncluded,
        row.evidenceSource,
        row.persistenceMode,
        row.evaluatedAt,
        row.expiresAt,
      ]
    );
    const [readbackRows] = await pool.execute(
      `SELECT manifest_sha256
         FROM effective_authority_shadow_decisions
        WHERE decision_id = ?
        LIMIT 1`,
      [row.decisionId]
    );
    if (readbackRows?.[0]?.manifest_sha256 !== row.manifestSha256) {
      const error = new Error("Effective authority decision evidence readback mismatch.");
      error.code = "AUTHORITY_EVIDENCE_READBACK_MISMATCH";
      throw error;
    }
    return Object.freeze({
      decisionId: row.decisionId,
      manifestSha256: row.manifestSha256,
      status: "persisted",
      readbackVerified: true,
    });
  }

  async function insertDriftEvent(input) {
    const row = normalizeDriftEvidence(input);
    const pool = requirePool(await resolvePool());
    await pool.execute(
      `INSERT INTO authority_projection_drift_events (
        drift_event_id,decision_id,tenant_id,projection_key,issue_code,registered_count,
        authorized_count,projected_count,executable_candidate_count,details_json,status,
        enforcement_mode,authority_granted,provider_call_made,credential_payload_read,
        external_write_made,secrets_included,detected_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE drift_event_id = drift_event_id`,
      [
        row.driftEventId,
        row.decisionId,
        row.tenantId,
        row.projectionKey,
        row.issueCode,
        row.registeredCount,
        row.authorizedCount,
        row.projectedCount,
        row.executableCandidateCount,
        row.detailsJson,
        row.status,
        row.enforcementMode,
        row.authorityGranted,
        row.providerCallMade,
        row.credentialPayloadRead,
        row.externalWriteMade,
        row.secretsIncluded,
        row.detectedAt,
      ]
    );
    return Object.freeze({
      driftEventId: row.driftEventId,
      decisionId: row.decisionId,
      issueCode: row.issueCode,
      status: "persisted",
    });
  }

  return Object.freeze({ insertDecision, insertDriftEvent });
}

export const _testingEffectiveAuthorityEvidenceRepository = Object.freeze({
  canonicalJson,
  normalizeDecisionEvidence,
  normalizeDriftEvidence,
});
