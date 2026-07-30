#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const domainPath = path.resolve(scriptDir, "..", "contextKernel", "domain", "executionCapsule.js");

const before = `  const canonical = createExecutionCapsule({
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    principalType: capsule.principalType,
    principalRef: capsule.principalRef,
    effectiveSubjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
    authorityPathRef: capsule.authorityPathRef,
    capabilityKey: capsule.capabilityKey,
    authorityRevision: capsule.authorityRevision,
    capabilityRevision: capsule.capabilityRevision,
    registryRevision: capsule.registryRevision,
    credentialReadinessRevision: capsule.credentialReadinessRevision,
    issuedAt: capsule.issuedAt,
    expiresAt: capsule.expiresAt,
    invalidationDependencies: capsule.invalidationDependencies,
    capsuleRef: capsule.capsuleRef,
  });`;

const after = `  const normalizedDependencies = buildDependencyMap(
    capsule.invalidationDependencies,
    "capsuleDependencies",
    MAX_CAPSULE_DEPENDENCIES + ExecutionCapsuleDependencyDomains.length,
  );
  const automaticDependencies = createExecutionCapsuleDependencyVector({
    contextRevision: capsule.contextRevision,
    principalRef: capsule.principalRef,
    effectiveSubjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
    authorityPathRef: capsule.authorityPathRef,
    capabilityKey: capsule.capabilityKey,
    authorityRevision: capsule.authorityRevision,
    capabilityRevision: capsule.capabilityRevision,
    registryRevision: capsule.registryRevision,
    credentialReadinessRevision: capsule.credentialReadinessRevision,
    invalidationDependencies: [],
  });
  const automaticKeys = new Set(automaticDependencies.map(dependencyKey));
  const additionalDependencies = [...normalizedDependencies.values()]
    .filter((dependency) => !automaticKeys.has(dependencyKey(dependency)));
  if (additionalDependencies.length > MAX_CAPSULE_DEPENDENCIES) {
    throw new TypeError("Execution capsule contains too many additional dependencies.");
  }
  const canonical = createExecutionCapsule({
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    principalType: capsule.principalType,
    principalRef: capsule.principalRef,
    effectiveSubjectRef: capsule.effectiveSubjectRef,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
    authorityPathRef: capsule.authorityPathRef,
    capabilityKey: capsule.capabilityKey,
    authorityRevision: capsule.authorityRevision,
    capabilityRevision: capsule.capabilityRevision,
    registryRevision: capsule.registryRevision,
    credentialReadinessRevision: capsule.credentialReadinessRevision,
    issuedAt: capsule.issuedAt,
    expiresAt: capsule.expiresAt,
    invalidationDependencies: additionalDependencies,
    capsuleRef: capsule.capsuleRef,
  });`;

let source = fs.readFileSync(domainPath, "utf8");
const first = source.indexOf(before);
if (first < 0) throw new Error("EC0 integrity reconstruction block not found");
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error("EC0 integrity reconstruction block is not unique");
}
source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
fs.writeFileSync(domainPath, source);
console.log("EC0 integrity reconstruction normalized");
