import {
  GrowthControlPlaneError,
  stableSha256
} from "./growthControlPlane.js";

export const ACTIVITY_SELECTION_INTENT_FIELDS = Object.freeze([
  "activityBindingId",
  "activityTypeKey",
  "activityPackKey"
]);

export const DEFAULT_ACTIVITY_SELECTION_STATUSES = Object.freeze(["active"]);

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_SELECTION_SCOPE_INVALID",
      "tenantId, workspaceId, and brandKey are required for activity selection.",
      422,
      [{ field: "scope", issue: "required" }]
    );
  }

  const normalized = Object.freeze({
    tenantId: normalizedText(scope.tenantId ?? scope.tenant_id),
    workspaceId: normalizedText(scope.workspaceId ?? scope.workspace_id),
    brandKey: normalizedText(scope.brandKey ?? scope.brand_key)
  });
  const missing = Object.entries(normalized)
    .filter(([, value]) => !value)
    .map(([field]) => field);

  if (missing.length > 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_SELECTION_SCOPE_INVALID",
      "tenantId, workspaceId, and brandKey are required for activity selection.",
      422,
      missing.map((field) => ({ field, issue: "required" }))
    );
  }
  return normalized;
}

function normalizedStatuses(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_SELECTION_STATUS_INVALID",
      "selectableStatuses must be a non-empty array.",
      422,
      [{ field: "selectableStatuses", issue: "invalid" }]
    );
  }
  const statuses = [...new Set(values.map((value) => normalizedText(value).toLowerCase()).filter(Boolean))];
  if (statuses.length === 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_SELECTION_STATUS_INVALID",
      "selectableStatuses must contain at least one status.",
      422,
      [{ field: "selectableStatuses", issue: "invalid" }]
    );
  }
  return Object.freeze(statuses);
}

function normalizedIntent(activityIntent) {
  if (activityIntent == null) return null;
  if (typeof activityIntent !== "object" || Array.isArray(activityIntent)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_INTENT_INVALID",
      "activityIntent must be an object.",
      422,
      [{ field: "activityIntent", issue: "invalid_type" }]
    );
  }

  const unknownFields = Object.keys(activityIntent)
    .filter((field) => !ACTIVITY_SELECTION_INTENT_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_INTENT_INVALID",
      "activityIntent contains unsupported fields.",
      422,
      unknownFields.map((field) => ({ field: `activityIntent.${field}`, issue: "unsupported" }))
    );
  }

  const selectors = ACTIVITY_SELECTION_INTENT_FIELDS
    .map((field) => ({ field, value: normalizedText(activityIntent[field]) }))
    .filter(({ value }) => Boolean(value));

  if (selectors.length === 0) return null;
  if (selectors.length > 1) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_INTENT_INVALID",
      "activityIntent must contain exactly one selector.",
      422,
      [{ field: "activityIntent", issue: "multiple_selectors" }]
    );
  }
  return Object.freeze(selectors[0]);
}

function normalizedBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
  return Object.freeze({
    activityBindingId: normalizedText(binding.activityBindingId ?? binding.activity_binding_id),
    tenantId: normalizedText(binding.tenantId ?? binding.tenant_id),
    workspaceId: normalizedText(binding.workspaceId ?? binding.workspace_id),
    brandKey: normalizedText(binding.brandKey ?? binding.brand_key),
    activityTypeKey: normalizedText(binding.activityTypeKey ?? binding.activity_type_key),
    activityPackKey: normalizedText(binding.activityPackKey ?? binding.activity_pack_key),
    activityPackVersion: Number(binding.activityPackVersion ?? binding.activity_pack_version ?? 0),
    status: normalizedText(binding.status).toLowerCase(),
    revision: Number(binding.revision ?? 0)
  });
}

function scopedCandidates(bindings, scope, statuses) {
  const statusSet = new Set(statuses);
  return bindings
    .map(normalizedBinding)
    .filter(Boolean)
    .filter((binding) => binding.tenantId === scope.tenantId)
    .filter((binding) => binding.workspaceId === scope.workspaceId)
    .filter((binding) => binding.brandKey === scope.brandKey)
    .filter((binding) => statusSet.has(binding.status));
}

function notFoundError(intent = null) {
  return new GrowthControlPlaneError(
    "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND",
    "No selectable activity binding exists for the requested scope and intent.",
    404,
    intent ? [{ field: `activityIntent.${intent.field}`, issue: "not_found" }] : []
  );
}

function ambiguousError(candidateCount, intent = null) {
  return new GrowthControlPlaneError(
    "GROWTH_CONTROL_ACTIVITY_SELECTION_AMBIGUOUS",
    "Multiple activity bindings are selectable; explicit activity intent is required.",
    409,
    [{
      field: intent ? `activityIntent.${intent.field}` : "activityIntent",
      issue: "ambiguous",
      candidateCount,
      allowedIntentFields: ACTIVITY_SELECTION_INTENT_FIELDS
    }]
  );
}

function selectionResult(binding, scope, intent, candidateCount) {
  const safeBinding = Object.freeze({ ...binding });
  const evidence = Object.freeze({
    scope,
    activityBindingId: safeBinding.activityBindingId,
    activityTypeKey: safeBinding.activityTypeKey,
    activityPackKey: safeBinding.activityPackKey,
    activityPackVersion: safeBinding.activityPackVersion,
    status: safeBinding.status,
    revision: safeBinding.revision,
    intent: intent ? { field: intent.field, value: intent.value } : null
  });

  return Object.freeze({
    binding: safeBinding,
    scope,
    selectionReason: intent ? "explicit_activity_intent" : "single_selectable_binding",
    candidateCount,
    evidenceSha256: stableSha256(evidence),
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false
  });
}

export function resolveActivityBindingSelection({
  bindings,
  scope,
  activityIntent = null,
  selectableStatuses = DEFAULT_ACTIVITY_SELECTION_STATUSES
} = {}) {
  if (!Array.isArray(bindings)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDINGS_INVALID",
      "bindings must be an array.",
      422,
      [{ field: "bindings", issue: "invalid_type" }]
    );
  }

  const normalizedSelectionScope = normalizedScope(scope);
  const normalizedSelectableStatuses = normalizedStatuses(selectableStatuses);
  const intent = normalizedIntent(activityIntent);
  const candidates = scopedCandidates(bindings, normalizedSelectionScope, normalizedSelectableStatuses);

  if (candidates.length === 0) throw notFoundError(intent);

  if (!intent) {
    if (candidates.length > 1) throw ambiguousError(candidates.length);
    return selectionResult(candidates[0], normalizedSelectionScope, null, candidates.length);
  }

  const matches = candidates.filter((binding) => binding[intent.field] === intent.value);
  if (matches.length === 0) throw notFoundError(intent);
  if (matches.length > 1) throw ambiguousError(matches.length, intent);
  return selectionResult(matches[0], normalizedSelectionScope, intent, candidates.length);
}

export const _testingActivityBindingSelection = Object.freeze({
  normalizedScope,
  normalizedStatuses,
  normalizedIntent,
  normalizedBinding,
  scopedCandidates
});
