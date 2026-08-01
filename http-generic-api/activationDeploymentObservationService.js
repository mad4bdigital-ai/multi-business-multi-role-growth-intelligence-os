import { createHash, randomUUID } from "node:crypto";

export const ACTIVATION_DEPLOYMENT_EVIDENCE_MAX_BYTES = 32768;
export const ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS = 256;
export const ACTIVATION_DEPLOYMENT_CORRELATION_STATUS = Object.freeze({
  FOUND: "found",
  NOT_FOUND: "not_found",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SOURCE_REF_PATTERN = /^[a-z0-9][a-z0-9._:/#-]{0,239}$/i;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api[_-]?key|private[_-]?key)/i;
const HEALTH_STATES = new Set(["pass", "warn", "fail", "unknown", "not_observed"]);
const CONTRACT_STATES = new Set(["pass", "warn", "fail", "unknown", "not_observed"]);

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

function normalizeUuid(value, field, { required = true } = {}) {
  const normalized = normalizeText(value, field, 36, { required });
  if (normalized && !UUID_PATTERN.test(normalized)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be a UUID.`);
  }
  return normalized;
}

function normalizeKey(value, field, fallback = null) {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  if (!KEY_PATTERN.test(normalized)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must use lowercase key syntax.`);
  }
  return normalized;
}

function normalizeSha(value, field) {
  const normalized = normalizeText(value, field, 40);
  if (normalized && !SHA_PATTERN.test(normalized)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be a full Git commit SHA.`);
  }
  return normalized?.toLowerCase() || null;
}

function normalizeInstant(value, field, { required = true } = {}) {
  const normalized = normalizeText(value, field, 64, { required });
  if (!normalized) return null;
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

function normalizeEvidenceStatus(value, field, allowed) {
  const normalized = normalizeKey(value, field, "not_observed");
  if (!allowed.has(normalized)) {
    fail(
      `activation_deployment_${field}_invalid`,
      `${field} is outside the supported evidence-state set.`,
    );
  }
  return normalized;
}

function canonicalize(value, depth = 0) {
  if (depth > 12) return "[depth-limited]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => canonicalize(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key], depth + 1)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 4000);
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 8) return "[depth-limited]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      sanitized[key] = sanitizeMetadata(item, depth + 1);
    }
    return sanitized;
  }
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 1000);
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function normalizeAuthorityEvidence(input, field, valueNormalizer) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be an evidence object.`);
  }
  const value = valueNormalizer(input.value, `${field}_value`);
  if (value === null || value === undefined || value === "") return null;
  return Object.freeze({
    value,
    source_type: normalizeKey(input.source_type, `${field}_source_type`),
    source_ref: normalizeSourceRef(input.source_ref, `${field}_source_ref`),
    observed_at: normalizeInstant(input.observed_at, `${field}_observed_at`),
  });
}

function normalizeReleaseEvidence(input, field) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(`activation_deployment_${field}_invalid`, `${field} must be an evidence object.`);
  }
  const commitSha = normalizeSha(input.commit_sha, `${field}_commit_sha`);
  const releaseId = normalizeText(input.release_id, `${field}_release_id`, 160);
  if (!commitSha && !releaseId) return null;
  return Object.freeze({
    commit_sha: commitSha,
    release_id: releaseId,
    source_type: normalizeKey(input.source_type, `${field}_source_type`),
    source_ref: normalizeSourceRef(input.source_ref, `${field}_source_ref`),
    observed_at: normalizeInstant(input.observed_at, `${field}_observed_at`),
    deployed_at: normalizeInstant(input.deployed_at, `${field}_deployed_at`, {
      required: false,
    }),
  });
}

function normalizeContractEvidence(input) {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("activation_deployment_contract_invalid", "contract must be an evidence object.");
  }
  return Object.freeze({
    version: normalizeText(input.version, "contract_version", 160),
    status: normalizeEvidenceStatus(input.status, "contract_status", CONTRACT_STATES),
    source_type: normalizeKey(input.source_type, "contract_source_type"),
    source_ref: normalizeSourceRef(input.source_ref, "contract_source_ref"),
    observed_at: normalizeInstant(input.observed_at, "contract_observed_at"),
  });
}

function assertNotAfter(value, upperBound, field, upperField = "observed_at") {
  if (!value || !upperBound) return;
  if (new Date(value).getTime() > new Date(upperBound).getTime()) {
    fail(
      `activation_deployment_${field}_after_${upperField}`,
      `${field} cannot be later than ${upperField}.`,
      409,
      { field, upper_field: upperField },
    );
  }
}

function assertObservationTimeline({
  observedAt,
  expectedRelease,
  deployedRelease,
  health,
  contract,
  migration,
}) {
  for (const [field, evidence] of [
    ["expected_release_observed_at", expectedRelease],
    ["deployed_release_observed_at", deployedRelease],
    ["health_observed_at", health],
    ["contract_observed_at", contract],
    ["migration_observed_at", migration],
  ]) {
    assertNotAfter(evidence?.observed_at, observedAt, field);
  }
  assertNotAfter(
    deployedRelease?.deployed_at,
    deployedRelease?.observed_at,
    "deployed_release_deployed_at",
    "deployed_release_observed_at",
  );
}

export function buildActivationDeploymentObservation(input = {}) {
  const observationId = normalizeUuid(input.observation_id || randomUUID(), "observation_id");
  const environmentKey = normalizeKey(
    input.environment_key || input.environment,
    "environment_key",
  );
  const observedAt = normalizeInstant(input.observed_at, "observed_at");
  const expectedRelease = normalizeReleaseEvidence(input.expected_release, "expected_release");
  const deployedRelease = normalizeReleaseEvidence(input.deployed_release, "deployed_release");
  const health = normalizeAuthorityEvidence(
    input.health,
    "health",
    (value, field) => normalizeEvidenceStatus(value, field, HEALTH_STATES),
  );
  const contract = normalizeContractEvidence(input.contract);
  const migration = normalizeAuthorityEvidence(
    input.migration,
    "migration",
    (value, field) => normalizeEvidenceStatus(value, field, HEALTH_STATES),
  );
  assertObservationTimeline({
    observedAt,
    expectedRelease,
    deployedRelease,
    health,
    contract,
    migration,
  });
  const metadata = sanitizeMetadata(input.metadata || {});

  const missingEvidence = [];
  if (!expectedRelease?.commit_sha) missingEvidence.push("expected_release.commit_sha");
  if (!deployedRelease?.commit_sha && !deployedRelease?.release_id) {
    missingEvidence.push("deployed_release.commit_sha_or_release_id");
  }
  if (!health || health.value === "not_observed") missingEvidence.push("health");
  if (!contract?.version || contract.status === "not_observed") missingEvidence.push("contract");

  const payload = {
    observation_id: observationId,
    environment_key: environmentKey,
    observed_at: observedAt,
    expected_release: expectedRelease,
    deployed_release: deployedRelease,
    health,
    contract,
    migration,
    metadata,
    evidence_complete: missingEvidence.length === 0,
    missing_evidence: Object.freeze(missingEvidence),
    classification_status: "not_computed",
    classification_authority_required: true,
    secrets_included: false,
  };
  const byteSize = Buffer.byteLength(stableJson(payload), "utf8");
  if (byteSize > ACTIVATION_DEPLOYMENT_EVIDENCE_MAX_BYTES) {
    fail(
      "activation_deployment_evidence_too_large",
      `Deployment observation exceeds ${ACTIVATION_DEPLOYMENT_EVIDENCE_MAX_BYTES} bytes.`,
      413,
    );
  }
  return Object.freeze({
    ...payload,
    evidence_sha256: sha256(payload),
    evidence_bytes: byteSize,
  });
}

function requireRepository(repository) {
  if (
    !repository ||
    typeof repository.appendObservation !== "function" ||
    typeof repository.listObservations !== "function"
  ) {
    fail(
      "activation_deployment_repository_invalid",
      "repository must provide appendObservation() and listObservations().",
      500,
    );
  }
}

function normalizeObservationList(observations) {
  const values = Array.isArray(observations) ? observations : [];
  if (values.length > ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS) {
    fail(
      "activation_deployment_observation_set_too_large",
      `No more than ${ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS} observations may be correlated at once.`,
      413,
    );
  }
  return values.map((item) => buildActivationDeploymentObservation(item));
}

function compareObservationOrder(left, right) {
  const timeDelta =
    new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime();
  if (timeDelta !== 0) return timeDelta;
  return String(right.observation_id).localeCompare(String(left.observation_id));
}

export function correlateActivationDeploymentObservation(
  observations,
  { environment_key, request_time } = {},
) {
  const environmentKey = normalizeKey(environment_key, "environment_key");
  const requestTime = normalizeInstant(request_time, "request_time");
  const requestEpoch = new Date(requestTime).getTime();
  const normalized = normalizeObservationList(observations);
  const matchingEnvironment = normalized.filter(
    (item) => item.environment_key === environmentKey,
  );
  const eligible = matchingEnvironment
    .filter((item) => new Date(item.observed_at).getTime() <= requestEpoch)
    .sort(compareObservationOrder);
  const futureIgnored = matchingEnvironment.length - eligible.length;
  const selected = eligible[0] || null;

  if (!selected) {
    return Object.freeze({
      correlation_status: ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.NOT_FOUND,
      environment_key: environmentKey,
      request_time: requestTime,
      observation: null,
      future_observations_ignored: futureIgnored,
      historical_correlation: true,
      classification_status: "not_computed",
      secrets_included: false,
    });
  }

  return Object.freeze({
    correlation_status: ACTIVATION_DEPLOYMENT_CORRELATION_STATUS.FOUND,
    environment_key: environmentKey,
    request_time: requestTime,
    observation: selected,
    observation_age_ms: Math.max(
      0,
      requestEpoch - new Date(selected.observed_at).getTime(),
    ),
    future_observations_ignored: futureIgnored,
    historical_correlation: true,
    classification_status: "not_computed",
    secrets_included: false,
  });
}

export function createActivationDeploymentObservationService({ repository } = {}) {
  requireRepository(repository);
  return Object.freeze({
    async recordObservation(input) {
      const observation = buildActivationDeploymentObservation(input);
      const result = await repository.appendObservation(observation);
      return Object.freeze({ observation, persistence: result || null });
    },
    async correlateAtRequestTime({ environment_key, request_time } = {}) {
      const environmentKey = normalizeKey(environment_key, "environment_key");
      const requestTime = normalizeInstant(request_time, "request_time");
      const observations = await repository.listObservations({
        environment_key: environmentKey,
        observed_at_lte: requestTime,
        limit: ACTIVATION_DEPLOYMENT_OBSERVATION_MAX_ITEMS,
      });
      return correlateActivationDeploymentObservation(observations, {
        environment_key: environmentKey,
        request_time: requestTime,
      });
    },
  });
}
