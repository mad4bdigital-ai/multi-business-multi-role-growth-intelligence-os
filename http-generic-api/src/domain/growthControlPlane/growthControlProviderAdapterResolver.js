import { GrowthControlPlaneError, stableSha256 } from "./growthControlPlane.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential(?!_reference_ready)|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_CANDIDATES = 200;
const MAX_LIST_ITEMS = 100;
const MAX_INPUT_BYTES = 524288;
const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "checkReadiness",
  "describeCapabilities",
  "dispatch",
  "inspect",
  "normalizeError",
  "normalizeResult",
  "prepareDispatch",
  "readback",
  "validateRequest",
]);
const OPTIONAL_ADAPTER_METHODS = Object.freeze(["cancel"]);
const ALLOWED_ROLLOUT_MODES = new Set([
  "shadow",
  "allowlist",
  "percentage",
  "canary",
  "general_availability",
]);
const BLOCKED_ROLLOUT_MODES = new Set(["off", "hard_disabled"]);
const READY_HEALTH_STATUSES = new Set(["healthy"]);

function resolverError(code, message, field = null, issue = null, extra = {}) {
  return new GrowthControlPlaneError(
    code,
    message,
    422,
    field ? [{ field, issue, ...extra }] : [],
  );
}

function fail(code, message, field = null, issue = null, extra = {}) {
  throw resolverError(code, message, field, issue, extra);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function assertBoundedJson(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", "Adapter resolver input must be JSON-serializable.", "input", "not_json_serializable");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_INPUT_BYTES) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_OVERSIZED", "Adapter resolver input exceeds the supported byte bound.", "input", "oversized");
  }
}

function assertSensitiveFree(value, field = "input", depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) {
      fail("GROWTH_CONTROL_ADAPTER_SENSITIVE_INPUT", "Adapter resolver input contains a secret-like value.", field, "forbidden_sensitive_value");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      fail("GROWTH_CONTROL_ADAPTER_SENSITIVE_INPUT", "Adapter resolver input contains a forbidden sensitive field.", `${field}.${key}`, "forbidden_sensitive_field");
    }
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function canonical(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  }
  return normalized;
}

function identifier(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a bounded opaque identifier.`, field, "invalid_identifier");
  }
  return normalized;
}

function sha256(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be SHA-256.`, field, "invalid_sha256");
  }
  return normalized;
}

function boundedInteger(value, field, minimum, maximum, fallback = null) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function boundedNumber(value, field, minimum, maximum, fallback = null) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function instant(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a valid instant.`, field, "invalid_instant");
  }
  return parsed.toISOString();
}

function sortedUnique(values, field, {
  required = false,
  normalize = canonical,
  maximum = MAX_LIST_ITEMS,
} = {}) {
  if (values == null) values = [];
  if (!Array.isArray(values) || values.length > maximum) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a bounded array.`, field, "invalid_or_oversized_array", { maximum });
  }
  const normalized = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && normalized.length === 0) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must not be empty.`, field, "required");
  }
  return normalized;
}

function normalizeContext(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CONTEXT_INVALID", "context must be an object.", "context", "invalid_type");
  }
  const now = instant(source.now ?? new Date(), "context.now");
  return deepFreeze({
    tenantId: identifier(source.tenantId ?? source.tenant_id, "context.tenantId"),
    workspaceId: identifier(source.workspaceId ?? source.workspace_id, "context.workspaceId", { nullable: true }),
    brandId: identifier(source.brandId ?? source.brand_id, "context.brandId", { nullable: true }),
    activityBindingId: identifier(source.activityBindingId ?? source.activity_binding_id, "context.activityBindingId", { nullable: true }),
    resourceId: identifier(source.resourceId ?? source.resource_id, "context.resourceId"),
    capabilityKey: canonical(source.capabilityKey ?? source.capability_key, "context.capabilityKey"),
    activityTypeKey: canonical(source.activityTypeKey ?? source.activity_type_key, "context.activityTypeKey"),
    channel: canonical(source.channel, "context.channel"),
    environment: canonical(source.environment, "context.environment"),
    preferredAdapterKey: canonical(source.preferredAdapterKey ?? source.preferred_adapter_key, "context.preferredAdapterKey", { nullable: true }),
    dispatchRequested: source.dispatchRequested === true || source.dispatch_requested === true,
    applyRequested: source.applyRequested === true || source.apply_requested === true,
    now,
  });
}

function normalizeCertification(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  return {
    status: canonical(source.status, `${field}.status`),
    environment: canonical(source.environment, `${field}.environment`),
    dispatchCertified: source.dispatchCertified === true || source.dispatch_certified === true,
    applyCertified: source.applyCertified === true || source.apply_certified === true,
    expiresAt: instant(source.expiresAt ?? source.expires_at, `${field}.expiresAt`),
    evidenceSha256: sha256(source.evidenceSha256 ?? source.evidence_sha256, `${field}.evidenceSha256`),
  };
}

function normalizeHealth(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  return {
    status: canonical(source.status, `${field}.status`),
    score: boundedNumber(source.score, `${field}.score`, 0, 100, 0),
    observedAt: instant(source.observedAt ?? source.observed_at, `${field}.observedAt`),
    maxAgeSeconds: boundedInteger(source.maxAgeSeconds ?? source.max_age_seconds, `${field}.maxAgeSeconds`, 30, 86400, 300),
    evidenceSha256: sha256(source.evidenceSha256 ?? source.evidence_sha256, `${field}.evidenceSha256`),
  };
}

function normalizeRollout(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  return {
    mode: canonical(source.mode, `${field}.mode`),
    eligible: source.eligible === true,
    cohortKey: canonical(source.cohortKey ?? source.cohort_key, `${field}.cohortKey`, { nullable: true }),
    evidenceSha256: sha256(source.evidenceSha256 ?? source.evidence_sha256, `${field}.evidenceSha256`),
  };
}

function normalizeReadiness(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  return {
    providerEnabled: source.providerEnabled === true || source.provider_enabled === true,
    connectionReady: source.connectionReady === true || source.connection_ready === true,
    credentialReferenceReady: source.credentialReferenceReady === true || source.credential_reference_ready === true,
    quotaReady: source.quotaReady === true || source.quota_ready === true,
  };
}

function normalizeScope(source, field) {
  const scope = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return {
    tenantId: identifier(scope.tenantId ?? scope.tenant_id, `${field}.tenantId`, { nullable: true }),
    workspaceId: identifier(scope.workspaceId ?? scope.workspace_id, `${field}.workspaceId`, { nullable: true }),
    brandId: identifier(scope.brandId ?? scope.brand_id, `${field}.brandId`, { nullable: true }),
    activityBindingId: identifier(scope.activityBindingId ?? scope.activity_binding_id, `${field}.activityBindingId`, { nullable: true }),
    resourceIds: sortedUnique(scope.resourceIds ?? scope.resource_ids, `${field}.resourceIds`, { normalize: identifier }),
  };
}

function normalizeCandidate(source, index) {
  const field = `registryCandidates[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  const methods = sortedUnique(source.contractMethods ?? source.contract_methods, `${field}.contractMethods`, {
    required: true,
    normalize: (value, methodField) => {
      const normalized = String(value ?? "").trim();
      if (!/^[A-Za-z][A-Za-z0-9]{2,63}$/.test(normalized)) {
        fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${methodField} is invalid.`, methodField, "invalid_method_name");
      }
      return normalized;
    },
  });
  return deepFreeze({
    adapterKey: canonical(source.adapterKey ?? source.adapter_key, `${field}.adapterKey`),
    adapterVersionId: identifier(source.adapterVersionId ?? source.adapter_version_id, `${field}.adapterVersionId`),
    providerBindingRef: identifier(source.providerBindingRef ?? source.provider_binding_ref, `${field}.providerBindingRef`),
    connectedSystemId: identifier(source.connectedSystemId ?? source.connected_system_id, `${field}.connectedSystemId`),
    connectionId: identifier(source.connectionId ?? source.connection_id, `${field}.connectionId`),
    endpointKey: canonical(source.endpointKey ?? source.endpoint_key, `${field}.endpointKey`),
    version: boundedInteger(source.version, `${field}.version`, 1, 1_000_000),
    definitionStatus: canonical(source.definitionStatus ?? source.definition_status, `${field}.definitionStatus`),
    versionStatus: canonical(source.versionStatus ?? source.version_status, `${field}.versionStatus`),
    immutable: source.immutable === true,
    capabilityKeys: sortedUnique(source.capabilityKeys ?? source.capability_keys, `${field}.capabilityKeys`, { required: true }),
    activityTypeKeys: sortedUnique(source.activityTypeKeys ?? source.activity_type_keys, `${field}.activityTypeKeys`, { required: true }),
    channels: sortedUnique(source.channels, `${field}.channels`, { required: true }),
    environments: sortedUnique(source.environments, `${field}.environments`, { required: true }),
    contractMethods: methods,
    scope: normalizeScope(source.scope, `${field}.scope`),
    bindingPriority: boundedInteger(source.bindingPriority ?? source.binding_priority, `${field}.bindingPriority`, 0, 10000, 0),
    preferenceWeight: boundedInteger(source.preferenceWeight ?? source.preference_weight, `${field}.preferenceWeight`, 0, 1000, 0),
    certification: normalizeCertification(source.certification, `${field}.certification`),
    health: normalizeHealth(source.health, `${field}.health`),
    rollout: normalizeRollout(source.rollout, `${field}.rollout`),
    readiness: normalizeReadiness(source.readiness, `${field}.readiness`),
  });
}

function requiredMethodBlockers(candidate) {
  const methods = new Set(candidate.contractMethods);
  return REQUIRED_ADAPTER_METHODS
    .filter((method) => !methods.has(method))
    .map((method) => ({ code: "ADAPTER_METHOD_REQUIRED", field: `contractMethods.${method}` }));
}

function scopeBlockers(candidate, context) {
  const blockers = [];
  const pairs = [
    ["tenant", candidate.scope.tenantId, context.tenantId],
    ["workspace", candidate.scope.workspaceId, context.workspaceId],
    ["brand", candidate.scope.brandId, context.brandId],
    ["activity_binding", candidate.scope.activityBindingId, context.activityBindingId],
  ];
  for (const [scope, expected, observed] of pairs) {
    if (expected != null && expected !== observed) {
      blockers.push({ code: "ADAPTER_SCOPE_MISMATCH", scope });
    }
  }
  if (candidate.scope.resourceIds.length > 0 && !candidate.scope.resourceIds.includes(context.resourceId)) {
    blockers.push({ code: "ADAPTER_RESOURCE_BINDING_MISMATCH" });
  }
  return blockers;
}

function compatibilityBlockers(candidate, context) {
  const blockers = [];
  if (!candidate.capabilityKeys.includes(context.capabilityKey)) blockers.push({ code: "ADAPTER_CAPABILITY_INCOMPATIBLE" });
  if (!candidate.activityTypeKeys.includes(context.activityTypeKey)) blockers.push({ code: "ADAPTER_ACTIVITY_INCOMPATIBLE" });
  if (!candidate.channels.includes(context.channel)) blockers.push({ code: "ADAPTER_CHANNEL_INCOMPATIBLE" });
  if (!candidate.environments.includes(context.environment)) blockers.push({ code: "ADAPTER_ENVIRONMENT_INCOMPATIBLE" });
  return blockers;
}

function certificationBlockers(candidate, context) {
  const blockers = [];
  const expiresAt = new Date(candidate.certification.expiresAt).getTime();
  const now = new Date(context.now).getTime();
  if (candidate.certification.status !== "certified") blockers.push({ code: "ADAPTER_CERTIFICATION_NOT_READY" });
  if (candidate.certification.environment !== context.environment) blockers.push({ code: "ADAPTER_CERTIFICATION_ENVIRONMENT_MISMATCH" });
  if (expiresAt <= now) blockers.push({ code: "ADAPTER_CERTIFICATION_EXPIRED" });
  if (context.dispatchRequested && !candidate.certification.dispatchCertified) blockers.push({ code: "ADAPTER_DISPATCH_NOT_CERTIFIED" });
  if (context.applyRequested && !candidate.certification.applyCertified) blockers.push({ code: "ADAPTER_APPLY_NOT_CERTIFIED" });
  return blockers;
}

function healthBlockers(candidate, context) {
  const blockers = [];
  const observedAt = new Date(candidate.health.observedAt).getTime();
  const now = new Date(context.now).getTime();
  const ageSeconds = Math.max(0, Math.floor((now - observedAt) / 1000));
  if (!READY_HEALTH_STATUSES.has(candidate.health.status)) blockers.push({ code: "ADAPTER_HEALTH_NOT_READY" });
  if (observedAt > now || ageSeconds > candidate.health.maxAgeSeconds) blockers.push({ code: "ADAPTER_HEALTH_EVIDENCE_STALE" });
  return blockers;
}

function rolloutBlockers(candidate, context) {
  const blockers = [];
  if (BLOCKED_ROLLOUT_MODES.has(candidate.rollout.mode) || !ALLOWED_ROLLOUT_MODES.has(candidate.rollout.mode)) {
    blockers.push({ code: "ADAPTER_ROLLOUT_BLOCKED" });
  }
  if (!candidate.rollout.eligible) blockers.push({ code: "ADAPTER_ROLLOUT_NOT_ELIGIBLE" });
  if (candidate.rollout.mode === "shadow" && (context.dispatchRequested || context.applyRequested)) {
    blockers.push({ code: "ADAPTER_SHADOW_EFFECT_FORBIDDEN" });
  }
  return blockers;
}

function readinessBlockers(candidate) {
  const blockers = [];
  if (!candidate.readiness.providerEnabled) blockers.push({ code: "ADAPTER_PROVIDER_DISABLED" });
  if (!candidate.readiness.connectionReady) blockers.push({ code: "ADAPTER_CONNECTION_NOT_READY" });
  if (!candidate.readiness.credentialReferenceReady) blockers.push({ code: "ADAPTER_CREDENTIAL_REFERENCE_NOT_READY" });
  if (!candidate.readiness.quotaReady) blockers.push({ code: "ADAPTER_QUOTA_NOT_READY" });
  return blockers;
}

function candidateBlockers(candidate, context) {
  const blockers = [];
  if (candidate.definitionStatus !== "active") blockers.push({ code: "ADAPTER_DEFINITION_NOT_ACTIVE" });
  if (candidate.versionStatus !== "active") blockers.push({ code: "ADAPTER_VERSION_NOT_ACTIVE" });
  if (!candidate.immutable) blockers.push({ code: "ADAPTER_VERSION_MUTABLE" });
  blockers.push(...requiredMethodBlockers(candidate));
  blockers.push(...scopeBlockers(candidate, context));
  blockers.push(...compatibilityBlockers(candidate, context));
  blockers.push(...certificationBlockers(candidate, context));
  blockers.push(...healthBlockers(candidate, context));
  blockers.push(...rolloutBlockers(candidate, context));
  blockers.push(...readinessBlockers(candidate));
  const unique = new Map();
  for (const blocker of blockers) {
    const key = stableSha256(blocker);
    if (!unique.has(key)) unique.set(key, blocker);
  }
  return [...unique.values()].sort((left, right) => stableSha256(left).localeCompare(stableSha256(right)));
}

function exactScopeScore(expected, observed) {
  return expected != null && expected === observed ? 1 : 0;
}

function rankVector(candidate, context) {
  return Object.freeze([
    context.preferredAdapterKey && candidate.adapterKey === context.preferredAdapterKey ? 1 : 0,
    candidate.scope.resourceIds.includes(context.resourceId) ? 1 : 0,
    exactScopeScore(candidate.scope.activityBindingId, context.activityBindingId),
    exactScopeScore(candidate.scope.brandId, context.brandId),
    exactScopeScore(candidate.scope.workspaceId, context.workspaceId),
    exactScopeScore(candidate.scope.tenantId, context.tenantId),
    candidate.preferenceWeight,
    candidate.bindingPriority,
    candidate.health.score,
    candidate.version,
  ]);
}

function compareRankVectors(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

function stableCandidateCompare(left, right) {
  const rankComparison = compareRankVectors(left.rankVector, right.rankVector);
  if (rankComparison !== 0) return rankComparison;
  return left.adapterKey.localeCompare(right.adapterKey)
    || left.adapterVersionId.localeCompare(right.adapterVersionId)
    || left.providerBindingRef.localeCompare(right.providerBindingRef);
}

function candidateEvidence(candidate, context) {
  const blockers = candidateBlockers(candidate, context);
  const vector = rankVector(candidate, context);
  const evidence = {
    adapter_key: candidate.adapterKey,
    adapter_version_id: candidate.adapterVersionId,
    provider_binding_ref: candidate.providerBindingRef,
    connected_system_id: candidate.connectedSystemId,
    connection_id: candidate.connectionId,
    endpoint_key: candidate.endpointKey,
    version: candidate.version,
    ready: blockers.length === 0,
    blockers,
    rank_vector: vector,
    certification_evidence_sha256: candidate.certification.evidenceSha256,
    health_evidence_sha256: candidate.health.evidenceSha256,
    rollout_evidence_sha256: candidate.rollout.evidenceSha256,
    provider_calls: false,
    provider_dispatch_allowed: false,
    provider_apply_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...evidence, candidate_evidence_sha256: stableSha256(evidence) });
}

export function resolveGrowthControlProviderAdapter({ registryCandidates = [], context: contextInput = {} } = {}) {
  assertBoundedJson({ registryCandidates, context: contextInput });
  assertSensitiveFree({ registryCandidates, context: contextInput });
  if (!Array.isArray(registryCandidates) || registryCandidates.length === 0 || registryCandidates.length > MAX_CANDIDATES) {
    fail("GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID", "registryCandidates must be a non-empty bounded array.", "registryCandidates", "invalid_or_oversized_array", { maximum: MAX_CANDIDATES });
  }
  const context = normalizeContext(contextInput);
  const normalized = registryCandidates.map(normalizeCandidate);
  const identities = new Set();
  for (const candidate of normalized) {
    const identity = `${candidate.adapterVersionId}:${candidate.providerBindingRef}`;
    if (identities.has(identity)) {
      fail("GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID", "Duplicate adapter-version binding identity is forbidden.", "registryCandidates", "duplicate_identity", { identity });
    }
    identities.add(identity);
  }

  const candidates = normalized.map((candidate) => candidateEvidence(candidate, context)).sort(stableCandidateCompare);
  const readyCandidates = candidates.filter((candidate) => candidate.ready);
  let status = "blocked";
  let blocker = "ADAPTER_NOT_READY";
  let selection = null;
  let tiedTopCandidates = [];

  if (readyCandidates.length > 0) {
    const [top] = readyCandidates;
    tiedTopCandidates = readyCandidates.filter(
      (candidate) => compareRankVectors(candidate.rank_vector, top.rank_vector) === 0,
    );
    if (tiedTopCandidates.length > 1) {
      status = "ambiguous";
      blocker = "ADAPTER_SELECTION_AMBIGUOUS";
    } else {
      status = "selected";
      blocker = null;
      selection = deepFreeze({
        adapter_key: top.adapter_key,
        adapter_version_id: top.adapter_version_id,
        provider_binding_ref: top.provider_binding_ref,
        connected_system_id: top.connected_system_id,
        connection_id: top.connection_id,
        endpoint_key: top.endpoint_key,
        version: top.version,
        rank_vector: top.rank_vector,
        candidate_evidence_sha256: top.candidate_evidence_sha256,
        certification_evidence_sha256: top.certification_evidence_sha256,
        health_evidence_sha256: top.health_evidence_sha256,
        rollout_evidence_sha256: top.rollout_evidence_sha256,
      });
    }
  }

  const withoutHash = {
    contract_version: "growth-control-provider-adapter-resolution-v1",
    status,
    ready: status === "selected",
    blocker,
    selection,
    tied_top_candidates: tiedTopCandidates.map((candidate) => ({
      adapter_key: candidate.adapter_key,
      adapter_version_id: candidate.adapter_version_id,
      provider_binding_ref: candidate.provider_binding_ref,
      rank_vector: candidate.rank_vector,
      candidate_evidence_sha256: candidate.candidate_evidence_sha256,
    })),
    candidates,
    candidate_count: candidates.length,
    ready_candidate_count: readyCandidates.length,
    context_sha256: stableSha256(context),
    authority_granted: false,
    runtime_authority_changed: false,
    provider_calls: false,
    provider_dispatch_allowed: false,
    provider_apply_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...withoutHash, resolution_sha256: stableSha256(withoutHash) });
}

export const growthControlProviderAdapterResolverContract = Object.freeze({
  version: "growth-control-provider-adapter-resolution-v1",
  registry_authorities: [
    "provider_adapter_definitions",
    "provider_adapter_versions",
    "provider_capability_bindings",
    "brand_provider_bindings",
    "provider_certifications",
    "provider_health_evidence",
    "rollout_decisions",
  ],
  required_adapter_methods: REQUIRED_ADAPTER_METHODS,
  optional_adapter_methods: OPTIONAL_ADAPTER_METHODS,
  ranking_order: [
    "explicit_preference",
    "exact_resource_binding",
    "exact_activity_binding",
    "exact_brand_binding",
    "exact_workspace_binding",
    "exact_tenant_binding",
    "preference_weight",
    "binding_priority",
    "health_score",
    "adapter_version",
  ],
  equal_top_rank: "ADAPTER_SELECTION_AMBIGUOUS",
  stable_identity_only_orders_evidence: true,
  exact_scope_compatibility_readiness_required: true,
  authority_granted: false,
  provider_calls: false,
  provider_dispatch_allowed: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderAdapterResolver = Object.freeze({
  normalizeContext,
  normalizeCandidate,
  requiredMethodBlockers,
  scopeBlockers,
  compatibilityBlockers,
  certificationBlockers,
  healthBlockers,
  rolloutBlockers,
  readinessBlockers,
  candidateBlockers,
  rankVector,
  compareRankVectors,
  stableCandidateCompare,
  candidateEvidence,
  assertSensitiveFree,
  deepFreeze,
});
