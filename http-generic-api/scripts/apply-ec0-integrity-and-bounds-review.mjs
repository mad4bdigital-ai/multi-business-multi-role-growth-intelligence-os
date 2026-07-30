#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const domainPath = path.join(apiRoot, "contextKernel", "domain", "executionCapsule.js");
const domainIndexPath = path.join(apiRoot, "contextKernel", "domain", "index.js");
const servicePath = path.join(apiRoot, "contextKernel", "application", "executionCapsuleService.js");
const testPath = path.join(apiRoot, "test-execution-capsule-contract.mjs");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let domain = fs.readFileSync(domainPath, "utf8");
domain = replaceExactlyOnce(
  domain,
  `  "credentialReadiness",\n]);`,
  `  "credentialReadiness",\n  "approval",\n  "capabilityEnvelope",\n  "effectiveAuthority",\n  "resourceVersion",\n  "providerVersion",\n  "connectionStatus",\n  "expectedVersion",\n]);`,
  "dynamic dependency domains",
);
domain = replaceExactlyOnce(
  domain,
  `  /^eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/u,\n]);`,
  `  /^eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/u,\n]);\nconst MAX_FIELD_LENGTH = 512;\nconst MAX_CAPSULE_DEPENDENCIES = 128;\nconst MAX_CURRENT_DEPENDENCIES = 256;\nconst MAX_CANONICAL_BYTES = 256 * 1024;`,
  "capsule bounds constants",
);
domain = replaceExactlyOnce(
  domain,
  `  const normalized = value.trim();\n  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {`,
  `  const normalized = value.trim();\n  if (normalized.length > MAX_FIELD_LENGTH) {\n    throw new TypeError(fieldName + " must contain at most " + MAX_FIELD_LENGTH + " characters.");\n  }\n  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {`,
  "bounded string contract",
);
domain = replaceExactlyOnce(
  domain,
  `function buildDependencyMap(dependencies, fieldName) {\n  const result = new Map();`,
  `function buildDependencyMap(dependencies, fieldName, maxDependencies) {\n  if (dependencies.length > maxDependencies) {\n    throw new TypeError(fieldName + " may contain at most " + maxDependencies + " dependencies.");\n  }\n  const result = new Map();`,
  "dependency map bounds",
);
domain = replaceExactlyOnce(
  domain,
  `export function createExecutionCapsuleHash(value) {\n  const canonical = canonicalize(value);\n  return crypto`,
  `function createExecutionCapsuleHash(value) {\n  const canonical = canonicalize(value);\n  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) {\n    throw new TypeError("Execution capsule canonical form exceeds the maximum size.");\n  }\n  return crypto`,
  "private bounded capsule hash",
);
domain = replaceExactlyOnce(
  domain,
  `  if (!Array.isArray(invalidationDependencies)) {\n    throw new TypeError("invalidationDependencies must be an array.");\n  }`,
  `  if (!Array.isArray(invalidationDependencies)) {\n    throw new TypeError("invalidationDependencies must be an array.");\n  }\n  if (invalidationDependencies.length > MAX_CAPSULE_DEPENDENCIES) {\n    throw new TypeError("invalidationDependencies may contain at most " + MAX_CAPSULE_DEPENDENCIES + " dependencies.");\n  }`,
  "capsule dependency count bound",
);
domain = replaceExactlyOnce(
  domain,
  `  return deepFreeze({\n    ...descriptor,\n    capsuleRef,\n    capsuleHash,\n    invalidationDependencies,\n    executionAllowed: false,\n    secretsIncluded: false,\n  });\n}\n\nexport function compareExecutionCapsuleDependencies`,
  `  return deepFreeze({\n    ...descriptor,\n    capsuleRef,\n    capsuleHash,\n    invalidationDependencies,\n    executionAllowed: false,\n    secretsIncluded: false,\n  });\n}\n\nexport function assertExecutionCapsuleIntegrity(capsule) {\n  if (!capsule || typeof capsule !== "object" || Array.isArray(capsule)) {\n    throw new TypeError("capsule must be an object.");\n  }\n  if (capsule.schemaVersion !== EXECUTION_CAPSULE_SCHEMA_VERSION) {\n    throw new TypeError("Execution capsule schema version is invalid.");\n  }\n  if (capsule.executionAllowed !== false || capsule.secretsIncluded !== false) {\n    throw new TypeError("Execution capsule security invariants are invalid.");\n  }\n  if (!Array.isArray(capsule.invalidationDependencies)) {\n    throw new TypeError("Execution capsule dependencies are invalid.");\n  }\n  if (typeof capsule.capsuleHash !== "string" || !/^[0-9a-f]{64}$/u.test(capsule.capsuleHash)) {\n    throw new TypeError("Execution capsule hash is invalid.");\n  }\n  const canonical = createExecutionCapsule({\n    contextHash: capsule.contextHash,\n    contextRevision: capsule.contextRevision,\n    principalType: capsule.principalType,\n    principalRef: capsule.principalRef,\n    effectiveSubjectRef: capsule.effectiveSubjectRef,\n    tenantRef: capsule.tenantRef,\n    workspaceRef: capsule.workspaceRef,\n    brandRef: capsule.brandRef,\n    resourceType: capsule.resourceType,\n    resourceRef: capsule.resourceRef,\n    connectionRef: capsule.connectionRef,\n    authorityPathRef: capsule.authorityPathRef,\n    capabilityKey: capsule.capabilityKey,\n    authorityRevision: capsule.authorityRevision,\n    capabilityRevision: capsule.capabilityRevision,\n    registryRevision: capsule.registryRevision,\n    credentialReadinessRevision: capsule.credentialReadinessRevision,\n    issuedAt: capsule.issuedAt,\n    expiresAt: capsule.expiresAt,\n    invalidationDependencies: capsule.invalidationDependencies,\n    capsuleRef: capsule.capsuleRef,\n  });\n  if (canonical.capsuleHash !== capsule.capsuleHash) {\n    throw new TypeError("Execution capsule canonical hash does not match.");\n  }\n  return canonical;\n}\n\nexport function compareExecutionCapsuleDependencies`,
  "capsule integrity contract",
);
domain = replaceExactlyOnce(
  domain,
  `  const expected = buildDependencyMap(capsuleDependencies, "capsuleDependencies");\n  const current = buildDependencyMap(currentDependencies, "currentDependencies");`,
  `  const expected = buildDependencyMap(\n    capsuleDependencies,\n    "capsuleDependencies",\n    MAX_CAPSULE_DEPENDENCIES + ExecutionCapsuleDependencyDomains.length,\n  );\n  const current = buildDependencyMap(\n    currentDependencies,\n    "currentDependencies",\n    MAX_CURRENT_DEPENDENCIES,\n  );`,
  "comparison dependency bounds",
);
const projectStart = domain.indexOf("export function projectExecutionCapsule");
if (projectStart < 0 || domain.indexOf("export function projectExecutionCapsule", projectStart + 1) >= 0) {
  throw new Error("projectExecutionCapsule function boundary is invalid");
}
domain = `${domain.slice(0, projectStart)}export function projectExecutionCapsule(capsule, mode = "tenant") {\n  const canonical = assertExecutionCapsuleIntegrity(capsule);\n  if (!ExecutionCapsuleProjectionModes.includes(mode)) {\n    throw new TypeError("Unsupported execution capsule projection mode: " + mode);\n  }\n\n  const tenantProjection = {\n    schemaVersion: canonical.schemaVersion,\n    capsuleRef: canonical.capsuleRef,\n    capsuleHash: canonical.capsuleHash,\n    contextHash: canonical.contextHash,\n    contextRevision: canonical.contextRevision,\n    effectiveSubjectRef: canonical.effectiveSubjectRef,\n    tenantRef: canonical.tenantRef,\n    workspaceRef: canonical.workspaceRef,\n    brandRef: canonical.brandRef,\n    resourceType: canonical.resourceType,\n    resourceRef: canonical.resourceRef,\n    connectionRef: canonical.connectionRef,\n    capabilityKey: canonical.capabilityKey,\n    issuedAt: canonical.issuedAt,\n    expiresAt: canonical.expiresAt,\n    executionAllowed: false,\n    secretsIncluded: false,\n  };\n  if (mode === "tenant") return deepFreeze(tenantProjection);\n\n  return deepFreeze({\n    ...tenantProjection,\n    principalType: canonical.principalType,\n    principalRef: canonical.principalRef,\n    authorityPathRef: canonical.authorityPathRef,\n    authorityRevision: canonical.authorityRevision,\n    capabilityRevision: canonical.capabilityRevision,\n    registryRevision: canonical.registryRevision,\n    credentialReadinessRevision: canonical.credentialReadinessRevision,\n    invalidationDependencies: canonical.invalidationDependencies,\n  });\n}\n`;

let domainIndex = fs.readFileSync(domainIndexPath, "utf8");
domainIndex = replaceExactlyOnce(
  domainIndex,
  `  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,\n  createExecutionCapsuleDependencyVector,\n  createExecutionCapsuleHash,\n  projectExecutionCapsule,`,
  `  assertExecutionCapsuleIntegrity,\n  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,\n  createExecutionCapsuleDependencyVector,\n  projectExecutionCapsule,`,
  "domain index integrity export",
);

let service = fs.readFileSync(servicePath, "utf8");
service = replaceExactlyOnce(
  service,
  `  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,`,
  `  assertExecutionCapsuleIntegrity,\n  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,`,
  "service integrity import",
);
service = replaceExactlyOnce(
  service,
  `function validationResult({`,
  `function integrityFailureResult(rawCapsule, validatedAt) {\n  const safeCapsuleRef = typeof rawCapsule?.capsuleRef === "string" &&\n    /^ctxc-[0-9a-f]{32}$/u.test(rawCapsule.capsuleRef)\n    ? rawCapsule.capsuleRef\n    : null;\n  return deepFreeze({\n    status: ExecutionCapsuleValidationStatus.BLOCKED,\n    valid: false,\n    capsuleRef: safeCapsuleRef,\n    contextHash: null,\n    contextRevision: null,\n    reasonCodes: ["execution_capsule_integrity_invalid"],\n    mismatchFields: [],\n    dependencyComparison: null,\n    requiresContextReresolution: true,\n    dynamicRefreshRequired: false,\n    executionAllowed: false,\n    automaticWritePerformed: false,\n    validatedAt,\n    secretsIncluded: false,\n  });\n}\n\nfunction validationResult({`,
  "integrity failure result",
);
service = replaceExactlyOnce(
  service,
  `    const identity = contextIdentity(context);\n    const readiness = resolved.capabilityReadiness || context.capability || null;`,
  `    const identity = contextIdentity(context);\n    const authorityScope = requireApplicationObject(\n      resolved.authorityScope || context.authority,\n      "resolution.authorityScope",\n    );\n    if (authorityScope.tenantRef && authorityScope.tenantRef !== identity.tenantRef) {\n      throw new ContextApplicationError(\n        "execution_capsule_authority_context_mismatch",\n        "Resolved authority scope and exact context do not reference the same Tenant.",\n        409,\n      );\n    }\n    const readiness = resolved.capabilityReadiness || context.capability || null;`,
  "authority context binding",
);
service = replaceExactlyOnce(
  service,
  `    if (\n      context.capability?.capabilityKey &&\n      context.capability.capabilityKey !== capabilityKey\n    ) {`,
  `    if (\n      context.capability && (\n        context.capability.capabilityKey !== capabilityKey ||\n        Boolean(context.capability.dispatchAllowed) !== Boolean(readiness.dispatchAllowed) ||\n        Boolean(context.capability.applyAllowed) !== Boolean(readiness.applyAllowed)\n      )\n    ) {`,
  "capability decision parity",
);
service = replaceExactlyOnce(
  service,
  `    const value = requireApplicationObject(capsule, "capsule");\n    const context = requireApplicationObject(currentContext, "currentContext");\n    if (!OPERATION_KINDS.has(operationKind)) {`,
  `    const rawCapsule = requireApplicationObject(capsule, "capsule");\n    const validatedAt = normalizedDate(now, "now").toISOString();\n    let value;\n    try {\n      value = assertExecutionCapsuleIntegrity(rawCapsule);\n    } catch {\n      return integrityFailureResult(rawCapsule, validatedAt);\n    }\n    const context = requireApplicationObject(currentContext, "currentContext");\n    if (!OPERATION_KINDS.has(operationKind)) {`,
  "validate canonical capsule first",
);
service = replaceExactlyOnce(
  service,
  `    const validatedAt = normalizedDate(now, "now").toISOString();\n\n    if (blockedReasonCodes.length > 0) {`,
  `    if (blockedReasonCodes.length > 0) {`,
  "remove duplicate validated timestamp",
);

let test = fs.readFileSync(testPath, "utf8");
test = replaceExactlyOnce(
  test,
  `  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,`,
  `  assertExecutionCapsuleIntegrity,\n  compareExecutionCapsuleDependencies,\n  createExecutionCapsule,`,
  "test integrity import",
);
test = replaceExactlyOnce(
  test,
  `assert(Object.isFrozen(capsule.invalidationDependencies));\nassert(capsule.invalidationDependencies.every(Object.isFrozen));`,
  `assert(Object.isFrozen(capsule.invalidationDependencies));\nassert(capsule.invalidationDependencies.every(Object.isFrozen));\nassert.equal(assertExecutionCapsuleIntegrity(capsule).capsuleHash, capsule.capsuleHash);\nassert.throws(\n  () => assertExecutionCapsuleIntegrity({ ...capsule, capsuleHash: "0".repeat(64) }),\n  /canonical hash does not match/u,\n);\nassert.throws(\n  () => projectExecutionCapsule({ ...capsule, executionAllowed: true }, "tenant"),\n  /security invariants/u,\n);\nassert.throws(\n  () => createBaseCapsule({ principalRef: "x".repeat(513) }),\n  /at most 512 characters/u,\n);\nassert.throws(\n  () => createBaseCapsule({\n    invalidationDependencies: Array.from({ length: 129 }, (_, index) => ({\n      domain: "resourceVersion",\n      ref: "resource-version-" + index,\n      revision: "revision-" + index,\n      refreshClass: "dynamic",\n    })),\n  }),\n  /at most 128 dependencies/u,\n);`,
  "integrity and bounds tests",
);
test = replaceExactlyOnce(
  test,
  `const dependencyVector = createExecutionCapsuleDependencyVector({\n  ...baseCapsuleInput,\n});`,
  `const dependencyVector = createExecutionCapsuleDependencyVector({\n  ...baseCapsuleInput,\n  invalidationDependencies: [\n    { domain: "approval", ref: "approval-a", revision: "approval-revision-a", refreshClass: "dynamic" },\n    { domain: "capabilityEnvelope", ref: "envelope-a", revision: "envelope-revision-a", refreshClass: "dynamic" },\n    { domain: "effectiveAuthority", ref: "grant-a", revision: "grant-revision-a", refreshClass: "dynamic" },\n    { domain: "resourceVersion", ref: "resource-version-a", revision: "resource-version-revision-a", refreshClass: "dynamic" },\n    { domain: "providerVersion", ref: "provider-version-a", revision: "provider-version-revision-a", refreshClass: "dynamic" },\n    { domain: "connectionStatus", ref: "connection-a", revision: "connection-status-revision-a", refreshClass: "dynamic" },\n    { domain: "expectedVersion", ref: "branch-main", revision: "expected-sha-a", refreshClass: "dynamic" },\n  ],\n});`,
  "dynamic operation dependency tests",
);
test = replaceExactlyOnce(
  test,
  `assert(dependencyVector.some((dependency) =>\n  dependency.domain === "credentialReadiness" &&\n  dependency.refreshClass === "dynamic"\n));`,
  `assert(dependencyVector.some((dependency) =>\n  dependency.domain === "credentialReadiness" &&\n  dependency.refreshClass === "dynamic"\n));\nfor (const domain of [\n  "approval",\n  "capabilityEnvelope",\n  "effectiveAuthority",\n  "resourceVersion",\n  "providerVersion",\n  "connectionStatus",\n  "expectedVersion",\n]) {\n  assert(dependencyVector.some((dependency) =>\n    dependency.domain === domain && dependency.refreshClass === "dynamic"\n  ));\n}`,
  "dynamic dependency assertions",
);
test = replaceExactlyOnce(
  test,
  `const currentContext = createResolution().context;\nconst currentDependencies = resolved.capsule.invalidationDependencies.map((dependency) => ({\n  ...dependency,\n}));`,
  `const currentContext = createResolution().context;\nconst currentDependencies = resolved.capsule.invalidationDependencies.map((dependency) => ({\n  ...dependency,\n}));\nconst forgedIntegrity = service.validate({\n  capsule: { ...resolved.capsule, capsuleHash: "0".repeat(64) },\n  currentContext,\n  currentDependencies,\n});\nassert.equal(forgedIntegrity.status, ExecutionCapsuleValidationStatus.BLOCKED);\nassert.deepEqual(forgedIntegrity.reasonCodes, ["execution_capsule_integrity_invalid"]);\nassert.equal(forgedIntegrity.executionAllowed, false);`,
  "service forged capsule rejection",
);
test = replaceExactlyOnce(
  test,
  `    authorityScope: {\n      tenantRef: "tenant-a",\n      role: "member",\n    },`,
  `    authorityScope: overrides.authorityScope || {\n      tenantRef: "tenant-a",\n      role: "member",\n    },`,
  "authority scope fixture override",
);
test = replaceExactlyOnce(
  test,
  `assert.throws(\n  () => resolveCapsule(createResolution({\n    capabilityReadiness: {`,
  `assert.throws(\n  () => resolveCapsule(createResolution({\n    authorityScope: { tenantRef: "tenant-b", role: "member" },\n  })),\n  (error) => error?.code === "execution_capsule_authority_context_mismatch",\n);\nassert.throws(\n  () => resolveCapsule(createResolution({\n    capabilityReadiness: {`,
  "authority mismatch regression",
);

fs.writeFileSync(domainPath, domain);
fs.writeFileSync(domainIndexPath, domainIndex);
fs.writeFileSync(servicePath, service);
fs.writeFileSync(testPath, test);
console.log("EC0 integrity and bounds review applied");
