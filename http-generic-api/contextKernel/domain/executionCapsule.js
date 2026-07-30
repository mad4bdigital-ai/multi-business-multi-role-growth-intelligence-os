import crypto from "node:crypto";

import { deepFreeze } from "./model.js";

export const EXECUTION_CAPSULE_SCHEMA_VERSION = 1;

export const ExecutionCapsuleDependencyDomains = deepFreeze([
  "principal",
  "effectiveSubject",
  "tenant",
  "workspace",
  "brand",
  "resource",
  "connection",
  "authority",
  "capability",
  "registry",
  "credentialReadiness",
]);

export const ExecutionCapsuleProjectionModes = deepFreeze([
  "tenant",
  "admin",
]);

const DEPENDENCY_DOMAIN_SET = new Set(ExecutionCapsuleDependencyDomains);
const REFRESH_CLASSES = new Set(["static", "dynamic"]);
const SECRET_VALUE_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|authorization|cookie|session)=/iu,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
]);

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new TypeError(`${fieldName} must not contain a secret-like value.`);
  }
  return normalized;
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireString(value, fieldName);
}

function normalizeDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must be a valid date.`);
  return date.toISOString();
}

function normalizeDependency(dependency, index, fieldName = "dependencies") {
  if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
    throw new TypeError(`${fieldName}[${index}] must be an object.`);
  }
  const domain = requireString(dependency.domain, `${fieldName}[${index}].domain`);
  if (!DEPENDENCY_DOMAIN_SET.has(domain)) {
    throw new TypeError(`Unsupported execution capsule dependency domain: ${domain}`);
  }
  const refreshClass = dependency.refreshClass || "static";
  if (!REFRESH_CLASSES.has(refreshClass)) {
    throw new TypeError(`Unsupported refreshClass: ${refreshClass}`);
  }
  return {
    domain,
    ref: requireString(dependency.ref, `${fieldName}[${index}].ref`),
    revision: requireString(dependency.revision, `${fieldName}[${index}].revision`),
    refreshClass,
  };
}

function dependencyKey(dependency) {
  return `${dependency.domain}:${dependency.ref}`;
}

function addDependency(target, dependency) {
  const key = dependencyKey(dependency);
  const existing = target.get(key);
  if (existing) {
    if (
      existing.revision !== dependency.revision ||
      existing.refreshClass !== dependency.refreshClass
    ) {
      throw new TypeError(`Conflicting execution capsule dependency: ${key}`);
    }
    return;
  }
  target.set(key, dependency);
}

function buildDependencyMap(dependencies, fieldName) {
  const result = new Map();
  dependencies.forEach((dependency, index) => {
    const normalized = normalizeDependency(dependency, index, fieldName);
    const key = dependencyKey(normalized);
    if (result.has(key)) throw new TypeError(`Duplicate ${fieldName} dependency: ${key}`);
    result.set(key, normalized);
  });
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function createExecutionCapsuleHash(value) {
  const canonical = canonicalize(value);
  return crypto
    .createHash("sha256")
    .update(`execution-capsule-v1:${canonical}`)
    .digest("hex");
}

export function createExecutionCapsuleDependencyVector({
  contextRevision,
  principalRef,
  effectiveSubjectRef,
  tenantRef,
  workspaceRef,
  brandRef = null,
  resourceType,
  resourceRef,
  connectionRef,
  authorityPathRef,
  capabilityKey,
  authorityRevision,
  capabilityRevision,
  registryRevision,
  credentialReadinessRevision,
  invalidationDependencies = [],
}) {
  const normalizedContextRevision = requireString(contextRevision, "contextRevision");
  const normalizedPrincipalRef = requireString(principalRef, "principalRef");
  const normalizedSubjectRef = requireString(effectiveSubjectRef, "effectiveSubjectRef");
  const normalizedTenantRef = requireString(tenantRef, "tenantRef");
  const normalizedWorkspaceRef = requireString(workspaceRef, "workspaceRef");
  const normalizedBrandRef = optionalString(brandRef, "brandRef");
  const normalizedResourceType = requireString(resourceType, "resourceType");
  const normalizedResourceRef = requireString(resourceRef, "resourceRef");
  const normalizedConnectionRef = requireString(connectionRef, "connectionRef");
  const normalizedAuthorityPathRef = requireString(authorityPathRef, "authorityPathRef");
  const normalizedCapabilityKey = requireString(capabilityKey, "capabilityKey");
  const normalizedAuthorityRevision = requireString(authorityRevision, "authorityRevision");
  const normalizedCapabilityRevision = requireString(capabilityRevision, "capabilityRevision");
  const normalizedRegistryRevision = requireString(registryRevision, "registryRevision");
  const normalizedCredentialRevision = requireString(
    credentialReadinessRevision,
    "credentialReadinessRevision",
  );

  if (!Array.isArray(invalidationDependencies)) {
    throw new TypeError("invalidationDependencies must be an array.");
  }

  const dependencies = new Map();
  const identityDependencies = [
    { domain: "principal", ref: normalizedPrincipalRef },
    { domain: "effectiveSubject", ref: normalizedSubjectRef },
    { domain: "tenant", ref: normalizedTenantRef },
    { domain: "workspace", ref: normalizedWorkspaceRef },
    ...(normalizedBrandRef ? [{ domain: "brand", ref: normalizedBrandRef }] : []),
    { domain: "resource", ref: `${normalizedResourceType}:${normalizedResourceRef}` },
    { domain: "connection", ref: normalizedConnectionRef },
  ];
  for (const dependency of identityDependencies) {
    addDependency(dependencies, {
      ...dependency,
      revision: normalizedContextRevision,
      refreshClass: "static",
    });
  }
  addDependency(dependencies, {
    domain: "authority",
    ref: normalizedAuthorityPathRef,
    revision: normalizedAuthorityRevision,
    refreshClass: "static",
  });
  addDependency(dependencies, {
    domain: "capability",
    ref: normalizedCapabilityKey,
    revision: normalizedCapabilityRevision,
    refreshClass: "static",
  });
  addDependency(dependencies, {
    domain: "registry",
    ref: "context-registry",
    revision: normalizedRegistryRevision,
    refreshClass: "static",
  });
  addDependency(dependencies, {
    domain: "credentialReadiness",
    ref: normalizedConnectionRef,
    revision: normalizedCredentialRevision,
    refreshClass: "dynamic",
  });

  invalidationDependencies
    .map((dependency, index) => normalizeDependency(
      dependency,
      index,
      "invalidationDependencies",
    ))
    .forEach((dependency) => addDependency(dependencies, dependency));

  return deepFreeze([...dependencies.values()].sort((left, right) =>
    left.domain.localeCompare(right.domain) ||
    left.ref.localeCompare(right.ref) ||
    left.revision.localeCompare(right.revision)
  ));
}

export function createExecutionCapsule(input = {}) {
  const issuedAt = normalizeDate(input.issuedAt, "issuedAt");
  const expiresAt = normalizeDate(input.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError("expiresAt must be later than issuedAt.");
  }

  const descriptor = {
    schemaVersion: EXECUTION_CAPSULE_SCHEMA_VERSION,
    contextHash: requireString(input.contextHash, "contextHash"),
    contextRevision: requireString(input.contextRevision, "contextRevision"),
    principalType: requireString(input.principalType, "principalType"),
    principalRef: requireString(input.principalRef, "principalRef"),
    effectiveSubjectRef: requireString(input.effectiveSubjectRef, "effectiveSubjectRef"),
    tenantRef: requireString(input.tenantRef, "tenantRef"),
    workspaceRef: requireString(input.workspaceRef, "workspaceRef"),
    brandRef: optionalString(input.brandRef, "brandRef"),
    resourceType: requireString(input.resourceType, "resourceType"),
    resourceRef: requireString(input.resourceRef, "resourceRef"),
    connectionRef: requireString(input.connectionRef, "connectionRef"),
    authorityPathRef: requireString(input.authorityPathRef, "authorityPathRef"),
    capabilityKey: requireString(input.capabilityKey, "capabilityKey"),
    authorityRevision: requireString(input.authorityRevision, "authorityRevision"),
    capabilityRevision: requireString(input.capabilityRevision, "capabilityRevision"),
    registryRevision: requireString(input.registryRevision, "registryRevision"),
    credentialReadinessRevision: requireString(
      input.credentialReadinessRevision,
      "credentialReadinessRevision",
    ),
    issuedAt,
    expiresAt,
  };

  const invalidationDependencies = createExecutionCapsuleDependencyVector({
    ...descriptor,
    invalidationDependencies: input.invalidationDependencies || [],
  });
  const capsuleHash = createExecutionCapsuleHash({
    ...descriptor,
    invalidationDependencies,
  });
  const capsuleRef = `ctxc-${capsuleHash.slice(0, 32)}`;
  if (input.capsuleRef && input.capsuleRef !== capsuleRef) {
    throw new TypeError("capsuleRef does not match the canonical capsule identity.");
  }

  return deepFreeze({
    ...descriptor,
    capsuleRef,
    capsuleHash,
    invalidationDependencies,
    executionAllowed: false,
    secretsIncluded: false,
  });
}

export function compareExecutionCapsuleDependencies(capsuleDependencies, currentDependencies) {
  if (!Array.isArray(capsuleDependencies) || !Array.isArray(currentDependencies)) {
    throw new TypeError("capsuleDependencies and currentDependencies must be arrays.");
  }
  const expected = buildDependencyMap(capsuleDependencies, "capsuleDependencies");
  const current = buildDependencyMap(currentDependencies, "currentDependencies");

  const changed = [];
  for (const [key, dependency] of expected.entries()) {
    const actual = current.get(key);
    if (!actual) {
      changed.push({ ...dependency, actualRevision: null, reason: "dependency_missing" });
      continue;
    }
    if (
      actual.revision !== dependency.revision ||
      actual.refreshClass !== dependency.refreshClass
    ) {
      changed.push({
        ...dependency,
        actualRevision: actual.revision,
        actualRefreshClass: actual.refreshClass,
        reason: actual.revision !== dependency.revision
          ? "dependency_revision_mismatch"
          : "dependency_refresh_class_mismatch",
      });
    }
  }

  return deepFreeze({
    valid: changed.length === 0,
    changed: changed.sort((left, right) =>
      left.domain.localeCompare(right.domain) || left.ref.localeCompare(right.ref)
    ),
    staticInvalidated: changed.some((dependency) => dependency.refreshClass === "static"),
    dynamicRefreshRequired: changed.some((dependency) => dependency.refreshClass === "dynamic"),
    secretsIncluded: false,
  });
}

export function projectExecutionCapsule(capsule, mode = "tenant") {
  if (!capsule || typeof capsule !== "object" || Array.isArray(capsule)) {
    throw new TypeError("capsule must be an object.");
  }
  if (!ExecutionCapsuleProjectionModes.includes(mode)) {
    throw new TypeError(`Unsupported execution capsule projection mode: ${mode}`);
  }

  const tenantProjection = {
    schemaVersion: capsule.schemaVersion,
    capsuleRef: capsule.capsuleRef,
    capsuleHash: capsule.capsuleHash,
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    effectiveSubjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
    capabilityKey: capsule.capabilityKey,
    issuedAt: capsule.issuedAt,
    expiresAt: capsule.expiresAt,
    executionAllowed: false,
    secretsIncluded: false,
  };
  if (mode === "tenant") return deepFreeze(tenantProjection);

  return deepFreeze({
    ...tenantProjection,
    principalType: capsule.principalType,
    principalRef: capsule.principalRef,
    authorityPathRef: capsule.authorityPathRef,
    authorityRevision: capsule.authorityRevision,
    capabilityRevision: capsule.capabilityRevision,
    registryRevision: capsule.registryRevision,
    credentialReadinessRevision: capsule.credentialReadinessRevision,
    invalidationDependencies: capsule.invalidationDependencies,
  });
}
