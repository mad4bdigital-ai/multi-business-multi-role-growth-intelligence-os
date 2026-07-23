import { assertNoSecretEvidence } from "../../domain/effectiveAuthority/effectiveAuthority.js";
import { evaluateConnectorProjectionConsistency } from "../../domain/effectiveAuthority/effectiveAuthorityEvidence.js";

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeScope(scope = {}) {
  const scopeType = cleanString(scope.scopeType);
  if (!new Set(["platform", "tenant"]).has(scopeType)) {
    throw new TypeError("Activation effective-authority projection requires a platform or tenant scope.");
  }
  const tenantId = cleanString(scope.tenantId);
  if (scopeType === "tenant" && !tenantId) {
    throw new TypeError("Tenant Activation effective-authority projection requires scope.tenantId.");
  }
  return Object.freeze({
    scopeId: cleanString(scope.scopeId),
    scopeKey:
      cleanString(scope.scopeKey) ||
      (scopeType === "platform" ? "platform:root" : `tenant:${tenantId}`),
    scopeType,
    tenantId: scopeType === "platform" ? null : tenantId,
    version: Number.isFinite(Number(scope.version)) ? Number(scope.version) : null,
  });
}

function safeErrorCode(error) {
  const code = cleanString(error?.code) || "AUTHORITY_PROJECTION_UNAVAILABLE";
  return /^[A-Z0-9_]{1,191}$/.test(code)
    ? code
    : "AUTHORITY_PROJECTION_UNAVAILABLE";
}

function evaluatedAt(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Activation effective-authority projection clock returned an invalid timestamp.");
  }
  return date.toISOString();
}

function freezeProjection(value) {
  assertNoSecretEvidence(value);
  return Object.freeze({
    ...value,
    subject_scope: Object.freeze({ ...value.subject_scope }),
    drift_issue_codes: Object.freeze([...(value.drift_issue_codes || [])]),
    projection_eligibility: Object.freeze({ ...value.projection_eligibility }),
  });
}

export function createActivationEffectiveAuthorityProjectionService({
  repository,
  now = () => new Date(),
  logger = null,
} = {}) {
  if (!repository || typeof repository.summarizeConnectorProjectionStages !== "function") {
    throw new TypeError(
      "Activation effective-authority projection requires summarizeConnectorProjectionStages()."
    );
  }

  async function project({ scope } = {}) {
    const normalizedScope = normalizeScope(scope);
    const timestamp = evaluatedAt(now);
    try {
      const counts = await repository.summarizeConnectorProjectionStages({
        scope: normalizedScope,
      });
      const consistency = evaluateConnectorProjectionConsistency({
        scopeType: normalizedScope.scopeType,
        ...counts,
      });
      return freezeProjection({
        source: "ueacp_activation_projection",
        status: consistency.driftDetected ? "degraded" : "active",
        availability: "available",
        decision: "shadow_ready",
        authority_granted: false,
        enforcement_mode: "shadow_only",
        legacy_runtime_authoritative: true,
        execution_authority_changed: false,
        subject_scope: normalizedScope,
        registered_count: consistency.counts.registeredCount,
        authorized_count: consistency.counts.authorizedCount,
        projected_count: consistency.counts.projectedCount,
        executable_candidate_count: consistency.counts.executableCandidateCount,
        drift_detected: consistency.driftDetected,
        drift_issue_codes: consistency.issueCodes,
        projection_eligibility: {
          activation: true,
          connector_inventory: true,
          execution: false,
        },
        evaluated_at: timestamp,
        provider_calls: false,
        credential_payload_reads: false,
        external_writes: false,
        secrets_included: false,
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      if (typeof logger?.warn === "function") {
        logger.warn({
          event: "ueacp_activation_projection_degraded",
          code: errorCode,
          scopeType: normalizedScope.scopeType,
          tenantId: normalizedScope.tenantId,
          secretsIncluded: false,
        });
      }
      return freezeProjection({
        source: "ueacp_activation_projection",
        status: "degraded",
        availability: "unavailable",
        decision: "degraded",
        authority_granted: false,
        enforcement_mode: "shadow_only",
        legacy_runtime_authoritative: true,
        execution_authority_changed: false,
        subject_scope: normalizedScope,
        registered_count: null,
        authorized_count: null,
        projected_count: null,
        executable_candidate_count: null,
        drift_detected: true,
        drift_issue_codes: ["AUTHORITY_PROJECTION_UNAVAILABLE"],
        error_code: errorCode,
        projection_eligibility: {
          activation: true,
          connector_inventory: false,
          execution: false,
        },
        evaluated_at: timestamp,
        provider_calls: false,
        credential_payload_reads: false,
        external_writes: false,
        secrets_included: false,
      });
    }
  }

  return Object.freeze({ project });
}
