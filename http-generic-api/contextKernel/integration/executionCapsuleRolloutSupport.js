export const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,255}$/u;
const TARGET_FIELDS = Object.freeze([
  "tenantRef", "workspaceRef", "resourceType", "resourceRef", "connectionRef",
]);
const IDENTITY_FIELDS = Object.freeze([
  "principalType", "principalRef", "effectiveSubjectRef", "tenantRef", "workspaceRef",
  "resourceType", "resourceRef", "connectionRef", "capabilityKey", "authorityPathRef",
]);
const REVISION_FIELDS = Object.freeze([
  "contextRevision", "authorityRevision", "capabilityRevision", "registryRevision",
  "credentialReadinessRevision",
]);

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object.`);
  }
  return value;
}

export function requireFunction(value, fieldName) {
  if (typeof value !== "function") throw new TypeError(`${fieldName} must be a function.`);
  return value;
}

export function requireToken(value, fieldName) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) throw new TypeError(`${fieldName} must be a bounded token.`);
  return token;
}

export function optionalToken(value, fieldName) {
  return value == null || value === "" ? null : requireToken(value, fieldName);
}

export function requireNonNegativeFinite(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new TypeError(`${fieldName} must be a non-negative finite number.`);
  }
  return numeric;
}

export function requireRatio(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new TypeError(`${fieldName} must be between 0 and 1.`);
  }
  return numeric;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const ordered = values.map(Number).sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function safeClockMilliseconds(clock) {
  try {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

export function durationMilliseconds(clock, startedAt) {
  const finishedAt = safeClockMilliseconds(clock);
  return Number.isFinite(startedAt) && Number.isFinite(finishedAt)
    ? Math.max(0, Math.round(finishedAt - startedAt))
    : 0;
}

export async function emitSafely(emitTelemetry, event) {
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Rollout telemetry cannot change resolution behavior.
  }
}

export function targetProjection(value) {
  const source = value?.context?.selectedCandidate || value?.context ||
    value?.selectedCandidate || value?.expectedTarget || value;
  return deepFreeze({
    tenantRef: source?.tenantRef ?? null,
    workspaceRef: source?.workspaceRef ?? null,
    brandRef: source?.brandRef ?? null,
    resourceType: source?.resourceType ?? null,
    resourceRef: source?.resourceRef ?? null,
    connectionRef: source?.connectionRef ?? null,
  });
}

export function completeTarget(value, fieldName) {
  const target = targetProjection(value);
  for (const field of TARGET_FIELDS) requireToken(target[field], `${fieldName}.${field}`);
  optionalToken(target.brandRef, `${fieldName}.brandRef`);
  return target;
}

export function targetMismatchFields(left, right) {
  return ["tenantRef", "workspaceRef", "brandRef", "resourceType", "resourceRef", "connectionRef"]
    .filter((field) => (left[field] ?? null) !== (right[field] ?? null));
}

export function defaultParityComparator(legacyResult, capsuleResult) {
  const legacyContext = legacyResult?.context || {};
  const capsuleContext = capsuleResult?.context || {};
  return targetMismatchFields(targetProjection(legacyResult), targetProjection(capsuleResult)).length === 0 &&
    (legacyResult?.status ?? null) === (capsuleResult?.status ?? null) &&
    (legacyContext.contextHash ?? null) === (capsuleContext.contextHash ?? null) &&
    (legacyContext.contextRevision ?? null) === (capsuleContext.contextRevision ?? null);
}

export function revisionBoundCacheKey(input) {
  const value = requireObject(input, "input");
  const identity = requireObject(value.contextIdentity, "input.contextIdentity");
  const revisions = requireObject(value.revisionVector, "input.revisionVector");
  const normalizedIdentity = Object.create(null);
  const normalizedRevisions = Object.create(null);
  for (const field of IDENTITY_FIELDS) {
    normalizedIdentity[field] = requireToken(identity[field], `input.contextIdentity.${field}`);
  }
  normalizedIdentity.brandRef = optionalToken(identity.brandRef, "input.contextIdentity.brandRef");
  for (const field of REVISION_FIELDS) {
    normalizedRevisions[field] = requireToken(revisions[field], `input.revisionVector.${field}`);
  }
  normalizedRevisions.resourceVersion = optionalToken(
    revisions.resourceVersion,
    "input.revisionVector.resourceVersion",
  );
  return JSON.stringify({ identity: normalizedIdentity, revisions: normalizedRevisions });
}
