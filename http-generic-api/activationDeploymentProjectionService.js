import { createHash } from "node:crypto";
import { ACTIVATION_DEPLOYMENT_CORRELATION_STATUS } from "./activationDeploymentObservationService.js";

export const ACTIVATION_DEPLOYMENT_STATES = Object.freeze([
  "current",
  "deploying",
  "stale",
  "diverged",
  "unknown",
]);

export const ACTIVATION_DEPLOYMENT_EXPOSURE_LEVELS = Object.freeze([
  "none",
  "opaque",
  "diagnostic",
  "admin_full",
]);

export const ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS = Object.freeze({
  public: "diagnostic",
  tenant: "diagnostic",
  admin: "admin_full",
  service: "admin_full",
});

export const ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS = Object.freeze({
  min: 1000,
  max: 7 * 24 * 60 * 60 * 1000,
});

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SOURCE_REF_PATTERN = /^[a-z0-9][a-z0-9._:/#-]{0,239}$/i;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api[_-]?key|private[_-]?key)/i;
const EXPOSURE_ORDER = Object.freeze({ none: 0, opaque: 1, diagnostic: 2, admin_full: 3 });
const PRINCIPAL_TYPES = new Set(Object.keys(ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS));

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeText(value, field, max, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) fail(`activation_deployment_${field}_required`, `${field} is required.`);
    return null;
  }
  if (normalized.length > max) {
    fail(`activation_deployment_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function normalizeKey(value, field) {
  const normalized = normalizeText(value, field, 80, { required: true })?.toLowerCase();
  if (!KEY_PATTERN.test(normalized)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must use lowercase key syntax.`);
  }
  return normalized;
}

function normalizeInstant(value, field) {
  const normalized = normalizeText(value, field, 64, { required: true });
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be an ISO-8601 instant.`);
  }
  return date.toISOString();
}

function normalizeSourceRef(value, field) {
  const normalized = normalizeText(value, field, 240, { required: true });
  if (
    !SOURCE_REF_PATTERN.test(normalized) ||
    normalized.includes("?") ||
    SENSITIVE_KEY_PATTERN.test(normalized)
  ) {
    fail(
      `activation_deployment_${field}_invalid`,
      `${field} must be an opaque governed reference without secrets or query parameters.`,
    );
  }
  return normalized;
}

function normalizeBooleanEvidence(input, field, requestTime) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.value !== "boolean") {
    fail(`activation_deployment_${field}_invalid`, `${field} must be a boolean evidence object.`);
  }
  const observedAt = normalizeInstant(input.observed_at, `${field}_observed_at`);
  if (new Date(observedAt).getTime() > new Date(requestTime).getTime()) {
    fail(
      `activation_deployment_${field}_after_request_time`,
      `${field} cannot be observed after request_time.`,
      409,
    );
  }
  return Object.freeze({
    value: input.value,
    source_type: normalizeKey(input.source_type, `${field}_source_type`),
    source_ref: normalizeSourceRef(input.source_ref, `${field}_source_ref`),
    observed_at: observedAt,
  });
}

function normalizeSequenceEvidence(input, field, requestTime) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be a sequence evidence object.`);
  }
  const value = Number(input.value);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      `activation_deployment_${field}_invalid`,
      `${field}.value must be a non-negative safe integer.`,
    );
  }
  const observedAt = normalizeInstant(input.observed_at, `${field}_observed_at`);
  if (new Date(observedAt).getTime() > new Date(requestTime).getTime()) {
    fail(
      `activation_deployment_${field}_after_request_time`,
      `${field} cannot be observed after request_time.`,
      409,
    );
  }
  return Object.freeze({
    value,
    source_type: normalizeKey(input.source_type, `${field}_source_type`),
    source_ref: normalizeSourceRef(input.source_ref, `${field}_source_ref`),
    observed_at: observedAt,
  });
}

function normalizeFreshnessWindow(value) {
  const normalized = Number(value);
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.min ||
    normalized > ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.max
  ) {
    fail(
      "activation_deployment_freshness_window_invalid",
      `freshness_window_ms must be between ${ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.min} and ${ACTIVATION_DEPLOYMENT_FRESHNESS_BOUNDS_MS.max}.`,
    );
  }
  return normalized;
}

function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function releaseIdentity(release) {
  if (!release || typeof release !== "object") return null;
  const commitSha = String(release.commit_sha || "").trim().toLowerCase();
  if (SHA_PATTERN.test(commitSha)) return `sha:${commitSha}`;
  const releaseId = String(release.release_id || "").trim();
  return releaseId ? `release:${releaseId}` : null;
}

export function deriveOpaqueDeploymentReleaseId({ environment_key, release } = {}) {
  const environmentKey = normalizeKey(environment_key, "environment_key");
  const identity = releaseIdentity(release);
  if (!identity) return null;
  const digest = createHash("sha256")
    .update(canonicalJson({ v: 1, environment_key: environmentKey, release: identity }), "utf8")
    .digest("hex")
    .slice(0, 24);
  return `rel_${digest}`;
}

function releasesMatch(expectedRelease, deployedRelease) {
  const expectedSha = String(expectedRelease?.commit_sha || "").trim().toLowerCase();
  const deployedSha = String(deployedRelease?.commit_sha || "").trim().toLowerCase();
  if (SHA_PATTERN.test(expectedSha) && SHA_PATTERN.test(deployedSha)) {
    return expectedSha === deployedSha;
  }
  const expectedId = String(expectedRelease?.release_id || "").trim();
  const deployedId = String(deployedRelease?.release_id || "").trim();
  return Boolean(expectedId && deployedId && expectedId === deployedId);
}

function classificationResult({
  status,
  reason_code,
  correlation,
  freshnessWindowMs,
  context,
}) {
  const observation = correlation?.observation || null;
  const environmentKey = correlation?.environment_key || observation?.environment_key || null;
  const runtimeVersion = deriveOpaqueDeploymentReleaseId({
    environment_key: environmentKey,
    release: observation?.deployed_release,
  });
  const expectedVersion = deriveOpaqueDeploymentReleaseId({
    environment_key: environmentKey,
    release: observation?.expected_release,
  });
  const ageMs = Number.isFinite(Number(correlation?.observation_age_ms))
    ? Math.max(0, Number(correlation.observation_age_ms))
    : null;
  const missingEvidence = Array.isArray(observation?.missing_evidence)
    ? [...observation.missing_evidence]
    : [];
  const nextAction = Object.freeze({
    current: null,
    deploying: "Wait for deployment completion and retry.",
    stale: "Wait for the reviewed release to reach this runtime, then retry.",
    diverged: "Contact an administrator; deployment evidence requires operator review.",
    unknown: "Retry later or contact an administrator if deployment evidence remains unavailable.",
  })[status];
  const recommendedHttpStatus = Object.freeze({
    current: 200,
    deploying: 202,
    stale: 202,
    diverged: 503,
    unknown: 503,
  })[status];

  return Object.freeze({
    status,
    reason_code,
    environment_key: environmentKey,
    request_time: correlation?.request_time || null,
    observed_at: observation?.observed_at || null,
    runtime_version: runtimeVersion,
    expected_version: expectedVersion,
    observation_age_ms: ageMs,
    freshness_window_ms: freshnessWindowMs,
    fresh: ageMs !== null && ageMs <= freshnessWindowMs,
    evidence_complete: Boolean(observation?.evidence_complete),
    missing_evidence: Object.freeze(missingEvidence),
    reconnect_required: false,
    next_action: nextAction,
    recommended_http_status: recommendedHttpStatus,
    correlation_status: correlation?.correlation_status || ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.NOT_FOUND,
    observation,
    classification_context: Object.freeze(context),
    secrets_included: false,
  });
}

export function classifyActivationDeployment(
  correlation,
  {
    freshness_window_ms,
    deployment_in_progress = null,
    authorized_lineage_match = null,
    environment_match = null,
    expected_release_sequence = null,
    deployed_release_sequence = null,
  } = {},
) {
  const freshnessWindowMs = normalizeFreshnessWindow(freshness_window_ms);
  const requestTime = normalizeInstant(
    correlation?.request_time || new Date(0).toISOString(),
    "request_time",
  );
  const context = {
    deployment_in_progress: normalizeBooleanEvidence(
      deployment_in_progress,
      "deployment_in_progress",
      requestTime,
    ),
    authorized_lineage_match: normalizeBooleanEvidence(
      authorized_lineage_match,
      "authorized_lineage_match",
      requestTime,
    ),
    environment_match: normalizeBooleanEvidence(environment_match, "environment_match", requestTime),
    expected_release_sequence: normalizeSequenceEvidence(
      expected_release_sequence,
      "expected_release_sequence",
      requestTime,
    ),
    deployed_release_sequence: normalizeSequenceEvidence(
      deployed_release_sequence,
      "deployed_release_sequence",
      requestTime,
    ),
  };

  if (
    !correlation ||
    correlation.correlation_status !== ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.FOUND ||
    !correlation.observation
  ) {
    return classificationResult({
      status: "unknown",
      reason_code: "deployment_observation_unavailable",
      correlation: correlation || {
        correlation_status: ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.NOT_FOUND,
        request_time: requestTime,
      },
      freshnessWindowMs,
      context,
    });
  }

  const observation = correlation.observation;
  const ageMs = Number(correlation.observation_age_ms);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > freshnessWindowMs) {
    return classificationResult({
      status: "unknown",
      reason_code: "deployment_observation_outside_freshness_window",
      correlation,
      freshnessWindowMs,
      context,
    });
  }

  if (!observation.contract || observation.contract.status !== "pass") {
    return classificationResult({
      status: "unknown",
      reason_code: "deployment_contract_evidence_invalid",
      correlation,
      freshnessWindowMs,
      context,
    });
  }

  if (context.authorized_lineage_match?.value === false) {
    return classificationResult({
      status: "diverged",
      reason_code: "deployment_release_lineage_mismatch",
      correlation,
      freshnessWindowMs,
      context,
    });
  }
  if (context.environment_match?.value === false) {
    return classificationResult({
      status: "diverged",
      reason_code: "deployment_environment_mismatch",
      correlation,
      freshnessWindowMs,
      context,
    });
  }

  const expectedRelease = observation.expected_release;
  const deployedRelease = observation.deployed_release;
  const exactMatch = releasesMatch(expectedRelease, deployedRelease);

  if (context.deployment_in_progress?.value === true && !exactMatch) {
    return classificationResult({
      status: "deploying",
      reason_code: "deployment_reviewed_release_in_progress",
      correlation,
      freshnessWindowMs,
      context,
    });
  }

  const expectedSequence = context.expected_release_sequence?.value;
  const deployedSequence = context.deployed_release_sequence?.value;
  if (Number.isSafeInteger(expectedSequence) && Number.isSafeInteger(deployedSequence)) {
    if (deployedSequence < expectedSequence) {
      return classificationResult({
        status: "stale",
        reason_code: "deployment_runtime_older_than_expected",
        correlation,
        freshnessWindowMs,
        context,
      });
    }
    if (deployedSequence > expectedSequence || !exactMatch) {
      return classificationResult({
        status: "diverged",
        reason_code:
          deployedSequence > expectedSequence
            ? "deployment_runtime_newer_than_expected_state"
            : "deployment_release_identity_sequence_conflict",
        correlation,
        freshnessWindowMs,
        context,
      });
    }
  }

  if (exactMatch) {
    if (observation.health?.value === "pass") {
      return classificationResult({
        status: "current",
        reason_code: "deployment_expected_runtime_health_contract_match",
        correlation,
        freshnessWindowMs,
        context,
      });
    }
    return classificationResult({
      status: "unknown",
      reason_code: "deployment_health_evidence_not_pass",
      correlation,
      freshnessWindowMs,
      context,
    });
  }

  return classificationResult({
    status: "unknown",
    reason_code: "deployment_release_ordering_evidence_unavailable",
    correlation,
    freshnessWindowMs,
    context,
  });
}

function normalizePrincipalType(value) {
  const normalized = normalizeKey(value, "principal_type");
  if (!PRINCIPAL_TYPES.has(normalized)) {
    fail("activation_deployment_principal_type_invalid", "principal_type is unsupported.");
  }
  return normalized;
}

function normalizeExposureLevel(value, field = "exposure_level") {
  const normalized = normalizeKey(value, field);
  if (!Object.hasOwn(EXPOSURE_ORDER, normalized)) {
    fail(`activation_deployment_${field}_invalid`, `${field} is unsupported.`);
  }
  return normalized;
}

function resolveExposureLevel({ principal_type, exposure_level }) {
  const principalType = normalizePrincipalType(principal_type);
  const requestedLevel = normalizeExposureLevel(exposure_level);
  const ceiling = ACTIVATION_DEPLOYMENT_PRINCIPAL_CEILINGS[principalType];
  if (EXPOSURE_ORDER[requestedLevel] > EXPOSURE_ORDER[ceiling]) {
    fail(
      "activation_deployment_exposure_not_allowed",
      `${principalType} principals cannot receive ${requestedLevel} deployment evidence.`,
      403,
      { requested_level: requestedLevel, maximum_level: ceiling },
    );
  }
  return { principal_type: principalType, exposure_level: requestedLevel, ceiling };
}

function diagnosticProjection(classification) {
  return Object.freeze({
    status: classification.status,
    runtime_version: classification.runtime_version,
    expected_version: classification.expected_version,
    observed_at: classification.observed_at,
    freshness: Object.freeze({
      age_ms: classification.observation_age_ms,
      window_ms: classification.freshness_window_ms,
      fresh: classification.fresh,
    }),
    completeness: Object.freeze({
      complete: classification.evidence_complete,
      missing_evidence: classification.missing_evidence,
    }),
    reconnect_required: false,
    next_action: classification.next_action,
    reason_code: classification.reason_code,
    recommended_http_status: classification.recommended_http_status,
  });
}

function adminProjection(classification) {
  const observation = classification.observation;
  return Object.freeze({
    ...diagnosticProjection(classification),
    request_time: classification.request_time,
    environment_key: classification.environment_key,
    correlation_status: classification.correlation_status,
    expected_release: observation?.expected_release || null,
    deployed_release: observation?.deployed_release || null,
    health: observation?.health || null,
    contract: observation?.contract || null,
    migration: observation?.migration || null,
    classification_context: classification.classification_context,
    evidence_sha256: observation?.evidence_sha256 || null,
    evidence_bytes: observation?.evidence_bytes || null,
    secrets_included: false,
  });
}

export function projectActivationDeploymentEvidence(
  classification,
  {
    principal_type,
    exposure_level,
    include_revision_header = false,
  } = {},
) {
  if (!classification || !ACTIVATION_DEPLOYMENT_STATES.includes(classification.status)) {
    fail("activation_deployment_classification_invalid", "A valid deployment classification is required.");
  }
  const exposure = resolveExposureLevel({ principal_type, exposure_level });
  let deployment = null;
  if (exposure.exposure_level === "opaque") {
    deployment = Object.freeze({
      status: classification.status,
      runtime_version: classification.runtime_version,
    });
  } else if (exposure.exposure_level === "diagnostic") {
    deployment = diagnosticProjection(classification);
  } else if (exposure.exposure_level === "admin_full") {
    deployment = adminProjection(classification);
  }

  const headers = {};
  if (include_revision_header === true && classification.runtime_version) {
    headers["Deployment-Revision"] = classification.runtime_version;
  }
  if (exposure.exposure_level === "none") {
    delete headers["Deployment-Revision"];
  }

  return Object.freeze({
    exposure_level: exposure.exposure_level,
    principal_type: exposure.principal_type,
    deployment,
    headers: Object.freeze(headers),
    secrets_included: false,
  });
}

export function createActivationDeploymentProjectionService() {
  return Object.freeze({
    classify: classifyActivationDeployment,
    project: projectActivationDeploymentEvidence,
    classifyAndProject(correlation, classificationOptions, projectionOptions) {
      const classification = classifyActivationDeployment(correlation, classificationOptions);
      return Object.freeze({
        classification,
        projection: projectActivationDeploymentEvidence(classification, projectionOptions),
      });
    },
  });
}
