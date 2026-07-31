import { GrowthControlPlaneError, stableSha256 } from "./growthControlPlane.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SAFE_SENSITIVE_FLAGS = new Set(["credentialReferenceReady", "credential_reference_ready"]);
const REQUIRED_METHODS = Object.freeze([
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
const OPTIONAL_METHODS = Object.freeze(["cancel"]);
const READY_ROLLOUT_MODES = new Set(["allowlist", "canary", "general_availability", "percentage", "shadow"]);
const MAX_CANDIDATES = 200;
const MAX_LIST_ITEMS = 100;
const MAX_INPUT_BYTES = 524288;

function fail(code, message, field = null, issue = null, extra = {}) {
  throw new GrowthControlPlaneError(code, message, 422, field ? [{ field, issue, ...extra }] : []);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function assertBoundedJson(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch {
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
    if (SENSITIVE_KEY_RE.test(key) && !SAFE_SENSITIVE_FLAGS.has(key)) {
      fail("GROWTH_CONTROL_ADAPTER_SENSITIVE_INPUT", "Adapter resolver input contains a forbidden sensitive field.", `${field}.${key}`, "forbidden_sensitive_field");
    }
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function canonical(value, field, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  return normalized;
}

function identifier(value, field, nullable = false) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!ID_RE.test(normalized)) fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a bounded opaque identifier.`, field, "invalid_identifier");
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA_RE.test(normalized)) fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be SHA-256.`, field, "invalid_sha256");
  return normalized;
}

function integer(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function number(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function isoInstant(value, field) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a valid instant.`, field, "invalid_instant");
  return parsed.toISOString();
}

function list(values, field, normalize = canonical, required = false) {
  if (values == null) values = [];
  if (!Array.isArray(values) || values.length > MAX_LIST_ITEMS) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must be a bounded array.`, field, "invalid_or_oversized_array");
  }
  const normalized = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && normalized.length === 0) fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} must not be empty.`, field, "required");
  return normalized;
}

function normalizeMethod(value, field) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]{2,63}$/.test(normalized)) {
    fail("GROWTH_CONTROL_ADAPTER_INPUT_INVALID", `${field} is not a supported method identifier.`, field, "invalid_method");
  }
  return normalized;
}

function normalizeContext(source = {}) {
  return deepFreeze({
    tenantId: identifier(source.tenantId ?? source.tenant_id, "context.tenantId"),
    workspaceId: identifier(source.workspaceId ?? source.workspace_id, "context.workspaceId", true),
    brandId: identifier(source.brandId ?? source.brand_id, "context.brandId", true),
    activityBindingId: identifier(source.activityBindingId ?? source.activity_binding_id, "context.activityBindingId", true),
    resourceId: identifier(source.resourceId ?? source.resource_id, "context.resourceId"),
    capabilityKey: canonical(source.capabilityKey ?? source.capability_key, "context.capabilityKey"),
    activityTypeKey: canonical(source.activityTypeKey ?? source.activity_type_key, "context.activityTypeKey"),
    channel: canonical(source.channel, "context.channel"),
    environment: canonical(source.environment, "context.environment"),
    preferredAdapterKey: canonical(source.preferredAdapterKey ?? source.preferred_adapter_key, "context.preferredAdapterKey", true),
    dispatchRequested: source.dispatchRequested === true || source.dispatch_requested === true,
    applyRequested: source.applyRequested === true || source.apply_requested === true,
    now: isoInstant(source.now ?? new Date(), "context.now"),
  });
}

function normalizeCandidate(source, index) {
  const field = `registryCandidates[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_ADAPTER_CANDIDATE_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  const scope = source.scope && typeof source.scope === "object" && !Array.isArray(source.scope) ? source.scope : {};
  const certification = source.certification || {};
  const health = source.health || {};
  const rollout = source.rollout || {};
  const readiness = source.readiness || {};
  return deepFreeze({
    adapterKey: canonical(source.adapterKey ?? source.adapter_key, `${field}.adapterKey`),
    adapterVersionId: identifier(source.adapterVersionId ?? source.adapter_version_id, `${field}.adapterVersionId`),
    providerBindingRef: identifier(source.providerBindingRef ?? source.provider_binding_ref, `${field}.providerBindingRef`),
    connectedSystemId: identifier(source.connectedSystemId ?? source.connected_system_id, `${field}.connectedSystemId`),
    connectionId: identifier(source.connectionId ?? source.connection_id, `${field}.connectionId`),
    endpointKey: canonical(source.endpointKey ?? source.endpoint_key, `${field}.endpointKey`),
    version: integer(source.version, `${field}.version`, 1, 1_000_000, 1),
    definitionStatus: canonical(source.definitionStatus ?? source.definition_status, `${field}.definitionStatus`),
    versionStatus: canonical(source.versionStatus ?? source.version_status, `${field}.versionStatus`),
    immutable: source.immutable === true,
    contractMethods: list(source.contractMethods ?? source.contract_methods, `${field}.contractMethods`, normalizeMethod, true),
    capabilityKeys: list(source.capabilityKeys ?? source.capability_keys, `${field}.capabilityKeys`, canonical, true),
    activityTypeKeys: list(source.activityTypeKeys ?? source.activity_type_keys, `${field}.activityTypeKeys`, canonical, true),
    channels: list(source.channels, `${field}.channels`, canonical, true),
    environments: list(source.environments, `${field}.environments`, canonical, true),
    scope: {
      tenantId: identifier(scope.tenantId ?? scope.tenant_id, `${field}.scope.tenantId`, true),
      workspaceId: identifier(scope.workspaceId ?? scope.workspace_id, `${field}.scope.workspaceId`, true),
      brandId: identifier(scope.brandId ?? scope.brand_id, `${field}.scope.brandId`, true),
      activityBindingId: identifier(scope.activityBindingId ?? scope.activity_binding_id, `${field}.scope.activityBindingId`, true),
      resourceIds: list(scope.resourceIds ?? scope.resource_ids, `${field}.scope.resourceIds`, identifier),
    },
    preferenceWeight: integer(source.preferenceWeight ?? source.preference_weight, `${field}.preferenceWeight`, 0, 1000, 0),
    bindingPriority: integer(source.bindingPriority ?? source.binding_priority, `${field}.bindingPriority`, 0, 10000, 0),
    certification: {
      status: canonical(certification.status, `${field}.certification.status`),
      environment: canonical(certification.environment, `${field}.certification.environment`),
      dispatchCertified: certification.dispatchCertified === true || certification.dispatch_certified === true,
      applyCertified: certification.applyCertified === true || certification.apply_certified === true,
      expiresAt: isoInstant(certification.expiresAt ?? certification.expires_at, `${field}.certification.expiresAt`),
      evidenceSha256: sha256(certification.evidenceSha256 ?? certification.evidence_sha256, `${field}.certification.evidenceSha256`),
    },
    health: {
      status: canonical(health.status, `${field}.health.status`),
      score: number(health.score, `${field}.health.score`, 0, 100, 0),
      observedAt: isoInstant(health.observedAt ?? health.observed_at, `${field}.health.observedAt`),
      maxAgeSeconds: integer(health.maxAgeSeconds ?? health.max_age_seconds, `${field}.health.maxAgeSeconds`, 30, 86400, 300),
      evidenceSha256: sha256(health.evidenceSha256 ?? health.evidence_sha256, `${field}.health.evidenceSha256`),
    },
    rollout: {
      mode: canonical(rollout.mode, `${field}.rollout.mode`),
      eligible: rollout.eligible === true,
      evidenceSha256: sha256(rollout.evidenceSha256 ?? rollout.evidence_sha256, `${field}.rollout.evidenceSha256`),
    },
    readiness: {
      providerEnabled: readiness.providerEnabled === true || readiness.provider_enabled === true,
      connectionReady: readiness.connectionReady === true || readiness.connection_ready === true,
      credentialReferenceReady: readiness.credentialReferenceReady === true || readiness.credential_reference_ready === true,
      quotaReady: readiness.quotaReady === true || readiness.quota_ready === true,
    },
  });
}

function blocker(code, detail = null) {
  return detail == null ? { code } : { code, detail };
}

function candidateBlockers(candidate, context) {
  const blockers = [];
  if (candidate.definitionStatus !== "active") blockers.push(blocker("ADAPTER_DEFINITION_NOT_ACTIVE"));
  if (candidate.versionStatus !== "active") blockers.push(blocker("ADAPTER_VERSION_NOT_ACTIVE"));
  if (!candidate.immutable) blockers.push(blocker("ADAPTER_VERSION_MUTABLE"));
  const methods = new Set(candidate.contractMethods);
  REQUIRED_METHODS.filter((method) => !methods.has(method)).forEach((method) => blockers.push(blocker("ADAPTER_METHOD_REQUIRED", method)));
  const scopes = [
    ["tenant", candidate.scope.tenantId, context.tenantId],
    ["workspace", candidate.scope.workspaceId, context.workspaceId],
    ["brand", candidate.scope.brandId, context.brandId],
    ["activity_binding", candidate.scope.activityBindingId, context.activityBindingId],
  ];
  scopes.filter(([, expected, observed]) => expected != null && expected !== observed)
    .forEach(([name]) => blockers.push(blocker("ADAPTER_SCOPE_MISMATCH", name)));
  if (candidate.scope.resourceIds.length && !candidate.scope.resourceIds.includes(context.resourceId)) blockers.push(blocker("ADAPTER_RESOURCE_BINDING_MISMATCH"));
  if (!candidate.capabilityKeys.includes(context.capabilityKey)) blockers.push(blocker("ADAPTER_CAPABILITY_INCOMPATIBLE"));
  if (!candidate.activityTypeKeys.includes(context.activityTypeKey)) blockers.push(blocker("ADAPTER_ACTIVITY_INCOMPATIBLE"));
  if (!candidate.channels.includes(context.channel)) blockers.push(blocker("ADAPTER_CHANNEL_INCOMPATIBLE"));
  if (!candidate.environments.includes(context.environment)) blockers.push(blocker("ADAPTER_ENVIRONMENT_INCOMPATIBLE"));
  const now = new Date(context.now).getTime();
  if (candidate.certification.status !== "certified") blockers.push(blocker("ADAPTER_CERTIFICATION_NOT_READY"));
  if (candidate.certification.environment !== context.environment) blockers.push(blocker("ADAPTER_CERTIFICATION_ENVIRONMENT_MISMATCH"));
  if (new Date(candidate.certification.expiresAt).getTime() <= now) blockers.push(blocker("ADAPTER_CERTIFICATION_EXPIRED"));
  if (context.dispatchRequested && !candidate.certification.dispatchCertified) blockers.push(blocker("ADAPTER_DISPATCH_NOT_CERTIFIED"));
  if (context.applyRequested && !candidate.certification.applyCertified) blockers.push(blocker("ADAPTER_APPLY_NOT_CERTIFIED"));
  const observedAt = new Date(candidate.health.observedAt).getTime();
  const ageSeconds = Math.floor((now - observedAt) / 1000);
  if (candidate.health.status !== "healthy") blockers.push(blocker("ADAPTER_HEALTH_NOT_READY"));
  if (ageSeconds < 0 || ageSeconds > candidate.health.maxAgeSeconds) blockers.push(blocker("ADAPTER_HEALTH_EVIDENCE_STALE"));
  if (!READY_ROLLOUT_MODES.has(candidate.rollout.mode)) blockers.push(blocker("ADAPTER_ROLLOUT_BLOCKED"));
  if (!candidate.rollout.eligible) blockers.push(blocker("ADAPTER_ROLLOUT_NOT_ELIGIBLE"));
  if (candidate.rollout.mode === "shadow" && (context.dispatchRequested || context.applyRequested)) blockers.push(blocker("ADAPTER_SHADOW_EFFECT_FORBIDDEN"));
  if (!candidate.readiness.providerEnabled) blockers.push(blocker("ADAPTER_PROVIDER_DISABLED"));
  if (!candidate.readiness.connectionReady) blockers.push(blocker("ADAPTER_CONNECTION_NOT_READY"));
  if (!candidate.readiness.credentialReferenceReady) blockers.push(blocker("ADAPTER_CREDENTIAL_REFERENCE_NOT_READY"));
  if (!candidate.readiness.quotaReady) blockers.push(blocker("ADAPTER_QUOTA_NOT_READY"));
  const unique = new Map(blockers.map((item) => [stableSha256(item), item]));
  return [...unique.values()].sort((left, right) => stableSha256(left).localeCompare(stableSha256(right)));
}

function exact(expected, observed) {
  return expected != null && expected === observed ? 1 : 0;
}

function rankVector(candidate, context) {
  return Object.freeze([
    context.preferredAdapterKey === candidate.adapterKey ? 1 : 0,
    candidate.scope.resourceIds.includes(context.resourceId) ? 1 : 0,
    exact(candidate.scope.activityBindingId, context.activityBindingId),
    exact(candidate.scope.brandId, context.brandId),
    exact(candidate.scope.workspaceId, context.workspaceId),
    exact(candidate.scope.tenantId, context.tenantId),
    candidate.preferenceWeight,
    candidate.bindingPriority,
    candidate.health.score,
    candidate.version,
  ]);
}

function compareRank(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

function compareCandidateEvidence(left, right) {
  return compareRank(left.rank_vector, right.rank_vector)
    || left.adapter_key.localeCompare(right.adapter_key)
    || left.adapter_version_id.localeCompare(right.adapter_version_id)
    || left.provider_binding_ref.localeCompare(right.provider_binding_ref);
}

function evidence(candidate, context) {
  const blockers = candidateBlockers(candidate, context);
  const base = {
    adapter_key: candidate.adapterKey,
    adapter_version_id: candidate.adapterVersionId,
    provider_binding_ref: candidate.providerBindingRef,
    connected_system_id: candidate.connectedSystemId,
    connection_id: candidate.connectionId,
    endpoint_key: candidate.endpointKey,
    version: candidate.version,
    ready: blockers.length === 0,
    blockers,
    rank_vector: rankVector(candidate, context),
    certification_evidence_sha256: candidate.certification.evidenceSha256,
    health_evidence_sha256: candidate.health.evidenceSha256,
    rollout_evidence_sha256: candidate.rollout.evidenceSha256,
    provider_calls: false,
    provider_dispatch_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...base, candidate_evidence_sha256: stableSha256(base) });
}

export function resolveGrowthControlProviderAdapter({ registryCandidates = [], context: contextInput = {} } = {}) {
  assertBoundedJson({ registryCandidates, context: contextInput });
  assertSensitiveFree({ registryCandidates, context: contextInput });
  if (!Array.isArray(registryCandidates) || registryCandidates.length < 1 || registryCandidates.length > MAX_CANDIDATES) {
    fail("GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID", "registryCandidates must be a non-empty bounded array.", "registryCandidates", "invalid_or_oversized_array");
  }
  const context = normalizeContext(contextInput);
  const normalized = registryCandidates.map(normalizeCandidate);
  const identities = new Set();
  for (const candidate of normalized) {
    const identity = `${candidate.adapterVersionId}:${candidate.providerBindingRef}`;
    if (identities.has(identity)) fail("GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID", "Duplicate adapter-version binding identity is forbidden.", "registryCandidates", "duplicate_identity", { identity });
    identities.add(identity);
  }
  const candidates = normalized.map((candidate) => evidence(candidate, context)).sort(compareCandidateEvidence);
  const readyCandidates = candidates.filter((candidate) => candidate.ready);
  const [topCandidate] = readyCandidates;
  const tied = topCandidate
    ? readyCandidates.filter((candidate) => compareRank(candidate.rank_vector, topCandidate.rank_vector) === 0)
    : [];
  const status = readyCandidates.length === 0 ? "blocked" : tied.length > 1 ? "ambiguous" : "selected";
  const selection = status === "selected" ? deepFreeze({
    adapter_key: topCandidate.adapter_key,
    adapter_version_id: topCandidate.adapter_version_id,
    provider_binding_ref: topCandidate.provider_binding_ref,
    connected_system_id: topCandidate.connected_system_id,
    connection_id: topCandidate.connection_id,
    endpoint_key: topCandidate.endpoint_key,
    version: topCandidate.version,
    rank_vector: topCandidate.rank_vector,
    candidate_evidence_sha256: topCandidate.candidate_evidence_sha256,
    certification_evidence_sha256: topCandidate.certification_evidence_sha256,
    health_evidence_sha256: topCandidate.health_evidence_sha256,
    rollout_evidence_sha256: topCandidate.rollout_evidence_sha256,
  }) : null;
  const base = {
    contract_version: "growth-control-provider-adapter-resolution-v1",
    status,
    ready: status === "selected",
    blocker: status === "blocked" ? "ADAPTER_NOT_READY" : status === "ambiguous" ? "ADAPTER_SELECTION_AMBIGUOUS" : null,
    selection,
    tied_top_candidates: tied.map((candidate) => ({
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
  return deepFreeze({ ...base, resolution_sha256: stableSha256(base) });
}

export const growthControlProviderAdapterResolverContract = Object.freeze({
  version: "growth-control-provider-adapter-resolution-v1",
  registry_authorities: [
    "brand_provider_bindings",
    "provider_adapter_definitions",
    "provider_adapter_versions",
    "provider_capability_bindings",
    "provider_certifications",
    "provider_health_evidence",
    "rollout_decisions",
  ],
  required_adapter_methods: REQUIRED_METHODS,
  optional_adapter_methods: OPTIONAL_METHODS,
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
  authority_granted: false,
  provider_calls: false,
  provider_dispatch_allowed: false,
  secrets_included: false,
});

export const _testingGrowthControlProviderAdapterResolver = Object.freeze({
  normalizeContext,
  normalizeCandidate,
  candidateBlockers,
  rankVector,
  compareRank,
  compareCandidateEvidence,
  evidence,
  assertSensitiveFree,
  deepFreeze,
});
