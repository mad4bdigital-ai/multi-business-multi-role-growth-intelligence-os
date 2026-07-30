import { randomUUID } from "node:crypto";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

export const GENERAL_MODE_CHOICE_POLICY_KEY = "general_mode_choice_before_execution";

const ALLOWED_SELECTION_SOURCES = new Set([
  "user_explicit",
  "policy_mandated",
  "single_valid_mode",
]);
const ALLOWED_RISK_CLASSES = new Set(["low", "medium", "high", "critical"]);

function modeChoiceError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function compact(value, max = 191) {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeKey(value, fieldName) {
  const key = compact(value, 191).toLowerCase().replace(/[^a-z0-9._:-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) {
    throw modeChoiceError(400, "mode_choice_key_required", `${fieldName} is required.`);
  }
  return key;
}

function normalizeTargetScope(value = {}) {
  const scopeType = normalizeKey(value.scope_type || value.type || "global", "target_scope.scope_type");
  const scopeRef = compact(value.scope_ref || value.ref || value.id || "*", 191) || "*";
  return {
    scope_type: scopeType,
    scope_ref: scopeRef,
    tenant_id: compact(value.tenant_id, 64) || null,
    workspace_id: compact(value.workspace_id, 64) || null,
    brand_key: compact(value.brand_key, 128) || null,
    resource_type: compact(value.resource_type, 128) || null,
    resource_id: compact(value.resource_id, 191) || null,
  };
}

function normalizeExpectedEvidence(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const evidence = [...new Set(items.map((item) => compact(item, 191)).filter(Boolean))];
  if (evidence.length === 0) {
    throw modeChoiceError(400, "mode_choice_expected_evidence_required", "Each mode must declare at least one expected evidence item.");
  }
  return evidence;
}

function normalizeModeOption(value = {}) {
  const modeKey = normalizeKey(value.mode_key || value.mode || value.key || value.value, "mode_key");
  const riskClass = normalizeKey(value.risk_class || value.risk, "risk_class");
  if (!ALLOWED_RISK_CLASSES.has(riskClass)) {
    throw modeChoiceError(400, "mode_choice_risk_class_invalid", "risk_class must be low, medium, high, or critical.", {
      mode_key: modeKey,
      risk_class: riskClass,
    });
  }
  const sideEffectClass = normalizeKey(value.side_effect_class || value.side_effect, "side_effect_class");
  const modeScope = value.scope && typeof value.scope === "object"
    ? normalizeTargetScope(value.scope)
    : null;
  return {
    mode_key: modeKey,
    label: compact(value.label || modeKey, 191),
    description: compact(value.description || "", 500) || null,
    risk_class: riskClass,
    side_effect_class: sideEffectClass,
    expected_evidence: normalizeExpectedEvidence(value.expected_evidence),
    scope: modeScope,
    recommended: value.recommended === true,
  };
}

function normalizeModeOptions(modes) {
  if (!Array.isArray(modes) || modes.length === 0) {
    throw modeChoiceError(400, "mode_choice_modes_required", "At least one valid mode is required.");
  }
  const normalized = modes.map(normalizeModeOption);
  const seen = new Set();
  for (const mode of normalized) {
    if (seen.has(mode.mode_key)) {
      throw modeChoiceError(409, "mode_choice_mode_duplicate", `Mode ${mode.mode_key} is declared more than once.`);
    }
    seen.add(mode.mode_key);
  }
  return normalized;
}

function resolveRecommendedMode(modes, explicitRecommendedMode) {
  if (explicitRecommendedMode) {
    const key = normalizeKey(explicitRecommendedMode, "recommended_mode");
    if (!modes.some((mode) => mode.mode_key === key)) {
      throw modeChoiceError(400, "mode_choice_recommended_mode_invalid", "recommended_mode is not one of the valid modes.", {
        recommended_mode: key,
      });
    }
    return key;
  }
  const recommended = modes.filter((mode) => mode.recommended);
  if (recommended.length > 1) {
    throw modeChoiceError(409, "mode_choice_recommendation_ambiguous", "Only one mode may be recommended.", {
      recommended_modes: recommended.map((mode) => mode.mode_key),
    });
  }
  return recommended.reduce((resolved, mode) => resolved || mode.mode_key, null);
}

function buildChoicePrompt({ surfaceKey, targetScope, modes, recommendedMode, fallbackFromMode }) {
  const lines = [
    `Executable surface: ${surfaceKey}`,
    `Target scope: ${targetScope.scope_type}:${targetScope.scope_ref}`,
    "Valid modes:",
  ];
  modes.forEach((mode, index) => {
    const recommendation = mode.mode_key === recommendedMode ? "; recommended" : "";
    const scope = mode.scope ? `; scope=${mode.scope.scope_type}:${mode.scope.scope_ref}` : "";
    lines.push(
      `${index + 1}. ${mode.mode_key} — ${mode.label}; risk=${mode.risk_class}; side_effect=${mode.side_effect_class}${scope}${recommendation}; evidence=${mode.expected_evidence.join(",")}`
    );
  });
  if (fallbackFromMode) lines.push(`Previous failed mode: ${fallbackFromMode}; a fresh choice is required before fallback execution.`);
  lines.push("Choose one mode before execution.");
  return lines.join("\n");
}

export function buildModeChoicePlan({
  choiceId = randomUUID(),
  surfaceKey,
  targetScope,
  modes,
  recommendedMode = null,
  selectedMode = null,
  mandatedMode = null,
  fallbackFromMode = null,
} = {}) {
  const normalizedSurfaceKey = normalizeKey(surfaceKey, "surface_key");
  const normalizedTargetScope = normalizeTargetScope(targetScope);
  const normalizedModes = normalizeModeOptions(modes);
  const modeKeys = new Set(normalizedModes.map((mode) => mode.mode_key));
  const resolvedRecommendedMode = resolveRecommendedMode(normalizedModes, recommendedMode);
  const normalizedFallback = fallbackFromMode ? normalizeKey(fallbackFromMode, "fallback_from_mode") : null;
  const normalizedSelected = selectedMode ? normalizeKey(selectedMode, "selected_mode") : null;
  const normalizedMandated = mandatedMode ? normalizeKey(mandatedMode, "mandated_mode") : null;

  if (normalizedSelected && !modeKeys.has(normalizedSelected)) {
    throw modeChoiceError(400, "mode_choice_selected_mode_invalid", "selected_mode is not one of the valid modes.", {
      selected_mode: normalizedSelected,
    });
  }
  if (normalizedMandated && !modeKeys.has(normalizedMandated)) {
    throw modeChoiceError(400, "mode_choice_mandated_mode_invalid", "mandated_mode is not one of the valid modes.", {
      mandated_mode: normalizedMandated,
    });
  }
  if (normalizedSelected && normalizedMandated && normalizedSelected !== normalizedMandated) {
    throw modeChoiceError(409, "mode_choice_policy_conflict", "The explicit selection conflicts with the policy-mandated mode.", {
      selected_mode: normalizedSelected,
      mandated_mode: normalizedMandated,
    });
  }

  let resolvedSelectedMode = null;
  let selectionSource = null;
  if (normalizedMandated) {
    resolvedSelectedMode = normalizedMandated;
    selectionSource = "policy_mandated";
  } else if (normalizedSelected) {
    resolvedSelectedMode = normalizedSelected;
    selectionSource = "user_explicit";
  } else if (normalizedModes.length === 1 && !normalizedFallback) {
    resolvedSelectedMode = normalizedModes.reduce((resolved, mode) => resolved || mode.mode_key, null);
    selectionSource = "single_valid_mode";
  }

  const fallbackRequiresUserChoice = Boolean(normalizedFallback && normalizedModes.length > 1 && !normalizedMandated);
  const modeChoiceRequired = !resolvedSelectedMode || fallbackRequiresUserChoice && !normalizedSelected;
  const executionAllowed = !modeChoiceRequired;
  const promptText = modeChoiceRequired
    ? buildChoicePrompt({
        surfaceKey: normalizedSurfaceKey,
        targetScope: normalizedTargetScope,
        modes: normalizedModes,
        recommendedMode: resolvedRecommendedMode,
        fallbackFromMode: normalizedFallback,
      })
    : null;

  return {
    choice_id: compact(choiceId, 64),
    policy_key: GENERAL_MODE_CHOICE_POLICY_KEY,
    surface_key: normalizedSurfaceKey,
    target_scope: normalizedTargetScope,
    mode_choice_required: modeChoiceRequired,
    mode_choices_presented: normalizedModes,
    recommended_mode: resolvedRecommendedMode,
    selected_mode: modeChoiceRequired ? null : resolvedSelectedMode,
    selection_source: modeChoiceRequired ? null : selectionSource,
    mode_default_used: false,
    mode_fallback_requires_user_choice: fallbackRequiresUserChoice,
    fallback_from_mode: normalizedFallback,
    execution_allowed: executionAllowed,
    prompt_text: promptText,
    secrets_included: false,
  };
}

function assertPersistablePlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw modeChoiceError(400, "mode_choice_plan_required", "A mode-choice plan is required.");
  }
  if (plan.mode_choice_required || !plan.execution_allowed || !plan.selected_mode) {
    throw modeChoiceError(409, "mode_choice_selection_required", "Mode choice evidence cannot be persisted before a valid selection exists.");
  }
  if (!ALLOWED_SELECTION_SOURCES.has(plan.selection_source)) {
    throw modeChoiceError(400, "mode_choice_selection_source_invalid", "selection_source is invalid.");
  }
  const normalizedModes = normalizeModeOptions(plan.mode_choices_presented);
  if (!normalizedModes.some((mode) => mode.mode_key === plan.selected_mode)) {
    throw modeChoiceError(409, "mode_choice_selection_not_presented", "selected_mode was not included in mode_choices_presented.");
  }
  return normalizedModes;
}

export async function persistModeChoiceSelection({
  plan,
  traceId = null,
  tenantId = null,
  workspaceId = null,
  userId = null,
  actorId = null,
  actorType = null,
  brandKey = null,
  requestId = null,
  sessionId = null,
  conversationId = null,
  correlationId = null,
  idempotencyKey = null,
  writeEvidence = writeExecutionEvidence,
  skipSurfaceAuthority = false,
} = {}) {
  const normalizedModes = assertPersistablePlan(plan);
  const evidenceTraceId = compact(traceId || plan.choice_id || randomUUID(), 191);
  const targetScope = normalizeTargetScope(plan.target_scope);
  const selectedMode = normalizeKey(plan.selected_mode, "selected_mode");
  const selectionSource = normalizeKey(plan.selection_source, "selection_source");
  const evidence = {
    mode_choice_required: false,
    mode_choices_presented: normalizedModes.map((mode) => ({
      mode_key: mode.mode_key,
      risk_class: mode.risk_class,
      side_effect_class: mode.side_effect_class,
      expected_evidence: mode.expected_evidence,
      scope: mode.scope,
    })),
    selected_mode: selectedMode,
    selection_source: selectionSource,
    recommended_mode: plan.recommended_mode || null,
    mode_default_used: false,
    mode_fallback_requires_user_choice: Boolean(plan.mode_fallback_requires_user_choice),
    fallback_from_mode: plan.fallback_from_mode || null,
    surface_key: normalizeKey(plan.surface_key, "surface_key"),
    target_scope: targetScope,
    policy_key: GENERAL_MODE_CHOICE_POLICY_KEY,
    secrets_included: false,
  };

  const result = await writeEvidence({
    traceId: evidenceTraceId,
    entryType: "mode_choice_selection",
    executionClass: "governed_mode_choice",
    sourceLayer: "mode_choice_governance",
    routeKeys: evidence.surface_key,
    executionMode: selectedMode,
    decisionTrigger: selectionSource,
    executionStatus: "selection_recorded",
    outputSummary: evidence,
    recoveryStatus: "not_required",
    routeStatus: "resolved",
    routeSource: "mode_choice_governance",
    intakeValidationStatus: "validated",
    executionReadyStatus: "ready",
    logSource: "mode_choice_governance",
    tenantId,
    workspaceId,
    userId,
    actorId,
    actorType,
    brandKey,
    requestId,
    sessionId,
    conversationId,
    policyKeys: GENERAL_MODE_CHOICE_POLICY_KEY,
    policyEvidence: evidence,
    runtimeEvidence: evidence,
    executionEvidenceStatus: "complete",
    targetType: targetScope.scope_type,
    targetId: targetScope.scope_ref,
    correlationId,
    idempotencyKey: idempotencyKey || `mode-choice:${plan.choice_id}`,
    skipSurfaceAuthority,
  });

  if (!result?.ok || !result?.row?.id) {
    throw modeChoiceError(503, "mode_choice_evidence_write_failed", "Selected mode evidence was not confirmed by execution-log readback.", {
      trace_id: evidenceTraceId,
    });
  }

  return {
    ok: true,
    choice_id: plan.choice_id,
    trace_id: result.trace_id || evidenceTraceId,
    execution_log_id: result.row.id,
    selected_mode: selectedMode,
    selection_source: selectionSource,
    evidence_recorded: true,
    secrets_included: false,
  };
}

export const _testingModeChoiceGovernance = Object.freeze({
  normalizeTargetScope,
  normalizeModeOption,
  normalizeModeOptions,
  resolveRecommendedMode,
  assertPersistablePlan,
});
