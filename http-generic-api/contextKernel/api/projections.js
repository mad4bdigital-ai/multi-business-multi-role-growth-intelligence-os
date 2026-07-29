import { paginateCandidates } from "./candidatePagination.js";
import {
  freezeApiValue,
  normalizeReasonCodes,
  requirePlainObject,
  requireString,
} from "./apiSupport.js";

const ADMIN_METADATA_KEYS = Object.freeze([
  "actionGrantMode",
  "actionGrantRef",
  "allowedModes",
  "appKey",
  "authType",
  "authoritySource",
  "permission",
  "primary",
  "recipeKey",
  "status",
  "validationStatus",
]);

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function safeAdminMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const safe = {};
  for (const key of ADMIN_METADATA_KEYS) {
    if (metadata[key] !== undefined) safe[key] = metadata[key];
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function projectTenantCandidate(candidate) {
  return compactObject([
    ["candidateType", requireString(candidate.candidateType, "candidate.candidateType")],
    ["stableRef", requireString(candidate.stableRef, "candidate.stableRef", { maxLength: 512 })],
    ["displayLabel", typeof candidate.displayLabel === "string" && candidate.displayLabel.trim() !== ""
      ? candidate.displayLabel.trim()
      : candidate.stableRef],
    ["authoritySummary", candidate.authoritySummary || undefined],
    ["readinessSummary", candidate.readinessSummary || undefined],
    ["reasonCodes", normalizeReasonCodes(candidate.reasonCodes)],
  ]);
}

function projectAdminCandidate(candidate) {
  return compactObject([
    ...Object.entries(projectTenantCandidate(candidate)),
    ["tenantRef", candidate.tenantRef || undefined],
    ["workspaceRef", candidate.workspaceRef || undefined],
    ["brandRef", candidate.brandRef || undefined],
    ["resourceType", candidate.resourceType || undefined],
    ["resourceRef", candidate.resourceRef || undefined],
    ["connectionRef", candidate.connectionRef || undefined],
    ["metadata", safeAdminMetadata(candidate.metadata)],
  ]);
}

function selectedContext(result) {
  const source = result.selectedContext || result.context || result.selectedCandidate || null;
  if (!source) return undefined;
  return compactObject([
    ["tenantRef", source.tenantRef || undefined],
    ["workspaceRef", source.workspaceRef || undefined],
    ["brandRef", source.brandRef || undefined],
    ["resourceType", source.resourceType || undefined],
    ["resourceRef", source.resourceRef || undefined],
    ["connectionRef", source.connectionRef || undefined],
  ]);
}

function safeReadiness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return compactObject([
    ["capabilityKey", value.capabilityKey || undefined],
    ["runtimeStatus", value.runtimeStatus || undefined],
    ["operationClass", value.operationClass || undefined],
    ["riskClass", value.riskClass || undefined],
    ["dispatchAllowed", value.dispatchAllowed === true],
    ["applyAllowed", value.applyAllowed === true],
    ["hardBlockCount", Number.isFinite(Number(value.hardBlockCount)) ? Number(value.hardBlockCount) : 0],
    ["manifestHash", value.manifestHash || undefined],
    ["manifestVersion", value.manifestVersion || undefined],
  ]);
}

export function projectContextResolution(value, {
  viewMode = "tenant",
  limit = 25,
  cursor = null,
} = {}) {
  const result = requirePlainObject(value, "contextResolution");
  if (!["admin", "tenant"].includes(viewMode)) throw new TypeError("viewMode must be admin or tenant.");
  const candidatePage = paginateCandidates(result.candidates || [], { limit, cursor });
  const projectCandidate = viewMode === "admin" ? projectAdminCandidate : projectTenantCandidate;
  const context = selectedContext(result);
  const base = compactObject([
    ["resolutionId", requireString(result.resolutionId, "resolutionId")],
    ["status", requireString(result.status, "status")],
    ["reasonCodes", normalizeReasonCodes(result.reasonCodes)],
    ["contextRevision", requireString(result.contextRevision || result.context?.contextRevision, "contextRevision", { maxLength: 128 })],
    ["contextHash", result.contextHash || result.context?.contextHash || undefined],
    ["selectedContext", context],
    ["candidates", candidatePage.items.map(projectCandidate)],
    ["candidatePage", candidatePage.page],
    ["expiresAt", result.expiresAt || undefined],
  ]);

  if (viewMode === "admin") {
    base.authorityScope = result.authorityScope || result.context?.authority || undefined;
    base.capabilityReadiness = safeReadiness(result.capabilityReadiness || result.context?.capability);
    base.diagnostics = {
      automaticWritePerformed: result.automaticWritePerformed === true,
      secretsIncluded: result.secretsIncluded === true,
    };
  }
  return freezeApiValue(base);
}

export function projectContextPin(value) {
  const pin = requirePlainObject(value, "contextPin");
  return freezeApiValue(compactObject([
    ["pinId", requireString(pin.pinId || pin.pinRef, "pinId")],
    ["resolutionId", requireString(pin.resolutionId, "resolutionId")],
    ["scope", requireString(pin.scope, "scope")],
    ["status", requireString(pin.status || "active", "status")],
    ["contextRevision", requireString(pin.contextRevision || pin.pin?.contextRevision, "contextRevision", { maxLength: 128 })],
    ["expiresAt", pin.expiresAt || pin.pin?.expiresAt || undefined],
  ]));
}

export function projectExecutionContext(value, { viewMode = "tenant" } = {}) {
  const execution = requirePlainObject(value, "executionContext");
  const readiness = requirePlainObject(execution.readiness, "readiness");
  const projected = {
    contextId: requireString(execution.contextId || execution.planRef, "contextId"),
    contextHash: requireString(execution.contextHash, "contextHash", { maxLength: 128 }),
    planHash: requireString(execution.planHash, "planHash", { maxLength: 128 }),
    status: requireString(execution.status, "status"),
    readiness: {
      contextReady: readiness.contextReady === true,
      operationReady: readiness.operationReady === true,
      blockingGaps: normalizeReasonCodes(readiness.blockingGaps),
    },
  };
  if (viewMode === "admin") {
    projected.capabilityKey = execution.capabilityKey || undefined;
    projected.approvalRef = execution.approvalRef || undefined;
    projected.expiresAt = execution.expiresAt || undefined;
  }
  return freezeApiValue(projected);
}

export function projectExecutionValidation(value) {
  const result = requirePlainObject(value, "executionValidation");
  return freezeApiValue(compactObject([
    ["valid", result.valid === true],
    ["reasonCodes", normalizeReasonCodes(result.reasonCodes)],
    ["contextRevision", result.contextRevision || undefined],
  ]));
}

export const _testingContextKernelProjections = Object.freeze({
  projectAdminCandidate,
  projectTenantCandidate,
  safeAdminMetadata,
  selectedContext,
});
