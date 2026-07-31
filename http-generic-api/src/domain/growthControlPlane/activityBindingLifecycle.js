import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  stableSha256
} from "./growthControlPlane.js";

export const ACTIVITY_BINDING_STATES = Object.freeze([
  "draft",
  "validating",
  "ready",
  "active",
  "blocked",
  "deprecated",
  "archived"
]);

export const ACTIVITY_BINDING_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["validating", "archived"]),
  validating: Object.freeze(["ready", "blocked"]),
  ready: Object.freeze(["active", "blocked", "archived"]),
  active: Object.freeze(["deprecated", "blocked"]),
  blocked: Object.freeze(["validating", "archived"]),
  deprecated: Object.freeze(["archived"]),
  archived: Object.freeze([])
});

const READINESS_ELIGIBLE_STATES = new Set(["draft", "validating", "blocked", "ready"]);
const READY_ACTIVITY_PACK_STATES = new Set(["ready", "active"]);
const BLOCKED_BRAND_CORE_STATES = new Set(["archived", "disabled", "inactive", "deleted", "placeholder"]);
const BLOCKED_BRAND_CORE_VALIDATION_STATES = new Set([
  "invalid",
  "failed",
  "blocked",
  "validating",
  "registered_pending_readback",
  "archived_placeholder"
]);

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedStatus(value, field) {
  const status = normalizedText(value).toLowerCase();
  if (!ACTIVITY_BINDING_STATES.includes(status)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_STATUS_INVALID",
      `${field} is not a supported activity binding status.`,
      422,
      [{ field, issue: "unsupported", value: status || null }]
    );
  }
  return status;
}

function expectedRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_INVALID",
      "expectedRevision must be a non-negative integer.",
      422,
      [{ field: "expectedRevision", issue: "invalid" }]
    );
  }
  return revision;
}

function normalizedDate(value, field) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_DATE_INVALID",
      `${field} must be a valid date-time.`,
      422,
      [{ field, issue: "invalid_date_time" }]
    );
  }
  return date;
}

function capabilityKey(value) {
  if (typeof value === "string") return normalizedText(value);
  if (value && typeof value === "object") {
    return normalizedText(value.capabilityKey ?? value.capability_key ?? value.key);
  }
  return "";
}

function capabilityStatusMap(value) {
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) {
    return new Map(value.map((entry) => [capabilityKey(entry), normalizedText(entry?.status).toLowerCase()]));
  }
  if (value && typeof value === "object") {
    return new Map(Object.entries(value).map(([key, status]) => [key, normalizedText(status).toLowerCase()]));
  }
  return new Map();
}

function brandCoreReadiness(brandCore) {
  if (!brandCore || typeof brandCore !== "object") {
    return { pass: false, code: "brand_core_missing" };
  }
  const status = normalizedText(brandCore.status).toLowerCase();
  const activeStatus = normalizedText(brandCore.activeStatus ?? brandCore.active_status).toLowerCase();
  const validationStatus = normalizedText(brandCore.validationStatus ?? brandCore.validation_status).toLowerCase();
  if (status !== "active" || BLOCKED_BRAND_CORE_STATES.has(activeStatus)) {
    return { pass: false, code: "brand_core_inactive" };
  }
  if (BLOCKED_BRAND_CORE_VALIDATION_STATES.has(validationStatus)) {
    return { pass: false, code: "brand_core_not_validated" };
  }
  return { pass: true, code: "brand_core_ready" };
}

function readinessCheck(code, pass, severity = "high", details = {}) {
  return Object.freeze({ code, pass: Boolean(pass), severity: pass ? "info" : severity, ...details });
}

export function evaluateActivityBindingReadiness({
  binding,
  brandCore,
  activityPack,
  capabilityStatuses = {},
  now = new Date()
} = {}) {
  if (!binding || typeof binding !== "object") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND",
      "Activity binding was not found.",
      404
    );
  }
  assertNoSecretFields({ binding, brandCore, activityPack, capabilityStatuses });
  const status = normalizedStatus(binding.status, "binding.status");
  const allowedCapabilities = Array.isArray(binding.allowedCapabilities ?? binding.allowed_capabilities)
    ? (binding.allowedCapabilities ?? binding.allowed_capabilities).map(capabilityKey).filter(Boolean)
    : [];
  const manifestCapabilities = Array.isArray(activityPack?.capabilities)
    ? activityPack.capabilities.map(capabilityKey).filter(Boolean)
    : [];
  const manifestCapabilitySet = new Set(manifestCapabilities);
  const statuses = capabilityStatusMap(capabilityStatuses);
  const effectiveFrom = normalizedDate(binding.effectiveFrom ?? binding.effective_from, "effectiveFrom");
  const effectiveTo = normalizedDate(binding.effectiveTo ?? binding.effective_to, "effectiveTo");
  const brandReadiness = brandCoreReadiness(brandCore);
  const packStatus = normalizedText(activityPack?.status).toLowerCase();
  const packActivityTypeKey = normalizedText(activityPack?.activityTypeKey ?? activityPack?.activity_type_key);
  const bindingActivityTypeKey = normalizedText(binding.activityTypeKey ?? binding.activity_type_key);
  const missingManifestCapabilities = allowedCapabilities.filter((key) => !manifestCapabilitySet.has(key));
  const inactiveCapabilities = allowedCapabilities.filter((key) => statuses.get(key) !== "active");
  const currentTime = normalizedDate(now, "now");

  const checks = Object.freeze([
    readinessCheck("binding_state_eligible", READINESS_ELIGIBLE_STATES.has(status), "medium", { status }),
    readinessCheck(brandReadiness.code, brandReadiness.pass, "critical"),
    readinessCheck("activity_pack_ready", READY_ACTIVITY_PACK_STATES.has(packStatus), "critical", { status: packStatus || null }),
    readinessCheck(
      "activity_type_compatible",
      Boolean(bindingActivityTypeKey) && bindingActivityTypeKey === packActivityTypeKey,
      "critical"
    ),
    readinessCheck("capabilities_selected", allowedCapabilities.length > 0, "high"),
    readinessCheck("capabilities_declared_by_pack", missingManifestCapabilities.length === 0, "critical", {
      missingCount: missingManifestCapabilities.length
    }),
    readinessCheck("capabilities_active", inactiveCapabilities.length === 0, "critical", {
      inactiveCount: inactiveCapabilities.length
    }),
    readinessCheck("effective_window_valid", !effectiveFrom || !effectiveTo || effectiveFrom < effectiveTo, "high"),
    readinessCheck("binding_not_expired", !effectiveTo || effectiveTo > currentTime, "high")
  ]);
  const ready = checks.every((check) => check.pass);
  const safeEvidence = Object.freeze({
    activityBindingId: normalizedText(binding.activityBindingId ?? binding.activity_binding_id),
    tenantId: normalizedText(binding.tenantId ?? binding.tenant_id),
    workspaceId: normalizedText(binding.workspaceId ?? binding.workspace_id),
    brandKey: normalizedText(binding.brandKey ?? binding.brand_key),
    revision: Number(binding.revision ?? 0),
    status,
    targetStatus: ready ? "ready" : "blocked",
    activityPackKey: normalizedText(binding.activityPackKey ?? binding.activity_pack_key),
    activityPackVersion: Number(binding.activityPackVersion ?? binding.activity_pack_version ?? 0),
    allowedCapabilityCount: allowedCapabilities.length,
    checkResults: checks.map((check) => ({ code: check.code, pass: check.pass, severity: check.severity }))
  });
  return Object.freeze({
    ready,
    targetStatus: ready ? "ready" : "blocked",
    bindingRevision: safeEvidence.revision,
    checks,
    evidenceSha256: stableSha256(safeEvidence),
    providerCalls: false,
    externalWrites: false,
    mutationAllowed: false,
    secretsIncluded: false
  });
}

export function planActivityBindingTransition({
  binding,
  targetStatus,
  expectedRevision: expectedRevisionValue,
  readiness = null,
  actorId = "platform_admin",
  now = new Date()
} = {}) {
  if (!binding || typeof binding !== "object") {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND", "Activity binding was not found.", 404);
  }
  const currentStatus = normalizedStatus(binding.status, "binding.status");
  const nextStatus = normalizedStatus(targetStatus, "targetStatus");
  const revision = Number(binding.revision ?? 0);
  const requiredRevision = expectedRevision(expectedRevisionValue);
  if (revision !== requiredRevision) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT",
      "Activity binding revision changed before the lifecycle transition.",
      409,
      [{ field: "expectedRevision", issue: "conflict", expected: requiredRevision, actual: revision }]
    );
  }
  if (!ACTIVITY_BINDING_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_TRANSITION_INVALID",
      `Transition from ${currentStatus} to ${nextStatus} is not allowed.`,
      422,
      [{ field: "targetStatus", issue: "illegal_transition", from: currentStatus, to: nextStatus }]
    );
  }
  if (nextStatus === "active") {
    if (!readiness?.ready || Number(readiness.bindingRevision) !== revision) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_ACTIVITY_BINDING_READINESS_REQUIRED",
        "A current passing readiness assessment is required before activation.",
        409,
        [{ field: "readiness", issue: "missing_or_stale" }]
      );
    }
  }
  const transitionTime = normalizedDate(now, "now");
  const effectiveFrom = normalizedDate(binding.effectiveFrom ?? binding.effective_from, "effectiveFrom");
  const effectiveTo = normalizedDate(binding.effectiveTo ?? binding.effective_to, "effectiveTo");
  const update = {
    status: nextStatus,
    revision: revision + 1,
    approvedBy: nextStatus === "active" ? normalizedText(actorId).slice(0, 128) || "platform_admin" : null,
    effectiveFrom: nextStatus === "active" ? (effectiveFrom || transitionTime) : effectiveFrom,
    effectiveTo: new Set(["deprecated", "archived"]).has(nextStatus) ? (effectiveTo || transitionTime) : effectiveTo
  };
  return Object.freeze({
    activityBindingId: normalizedText(binding.activityBindingId ?? binding.activity_binding_id),
    fromStatus: currentStatus,
    targetStatus: nextStatus,
    expectedRevision: requiredRevision,
    update: Object.freeze(update),
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false
  });
}

export const _testingActivityBindingLifecycle = Object.freeze({
  normalizedStatus,
  expectedRevision,
  normalizedDate,
  capabilityKey,
  capabilityStatusMap,
  brandCoreReadiness
});
