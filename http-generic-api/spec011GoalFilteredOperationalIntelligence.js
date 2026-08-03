import { createHash } from "node:crypto";
import { buildActivationOperationalIntelligenceEvidence } from "./activationOperationalIntelligenceEvidence.js";

export const SPEC011_GOAL_FILTERED_INTELLIGENCE_VERSION =
  "spec011-goal-filtered-operational-intelligence-v1";

export const GOAL_ATTENTION_CLASSES = Object.freeze([
  "blocking",
  "related_risk",
  "platform_wide",
  "unrelated",
]);

const CLASS_SET = new Set(GOAL_ATTENTION_CLASSES);
const TERMINAL_OPERATION_STATUSES = new Set(["completed", "succeeded", "cancelled"]);
const BLOCKED_OPERATION_STATUSES = new Set(["blocked", "failed", "error"]);
const ACTIVE_OPERATION_STATUSES = new Set(["running", "in_progress", "executing", "queued"]);
const APPROVAL_OPERATION_STATUSES = new Set([
  "awaiting_approval",
  "approval_required",
  "awaiting_input",
  "paused",
]);
const BLOCKING_REASON_PATTERN = /(block|fail|error|expired|required|unavailable|outage|drift|denied|missing|stale)/i;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];
const REFERENCE_PATTERN = /^(?:diagnostic|evidence|operation|attention|activation):\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/;
const DEFAULT_LIMITS = Object.freeze({
  blocking: 5,
  related_risk: 4,
  platform_wide: 3,
  linked_operations: 6,
  blockers: 8,
  next_actions: 8,
  max_summary_bytes: 64 * 1024,
});

function intelligenceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(stable(value));
  return createHash("sha256").update(serialized).digest("hex");
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 14) {
    throw intelligenceError("GOAL_INTELLIGENCE_DEPTH_EXCEEDED", "Operational intelligence input exceeds maximum depth.", { path });
  }
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw intelligenceError("GOAL_INTELLIGENCE_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) && key !== "secrets_included") {
      throw intelligenceError("GOAL_INTELLIGENCE_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function uniqueStrings(values, max = 500) {
  const input = Array.isArray(values) ? values : values === null || values === undefined ? [] : [values];
  return [...new Set(input.map((value) => compact(value, max)).filter(Boolean))].sort();
}

function normalizeStatus(value) {
  return compact(value || "unknown", 64).toLowerCase();
}

function intersection(left = [], right = []) {
  const accepted = new Set(right);
  return left.filter((value) => accepted.has(value));
}

function normalizeGoal(goal = {}) {
  assertSecretFree(goal, "goal");
  const goalId = compact(goal.goal_id || goal.goal_ref || goal.id, 191);
  if (!goalId) throw intelligenceError("GOAL_ID_REQUIRED", "goal_id is required.");
  const normalized = {
    goal_id: goalId,
    title: compact(goal.title || goal.name || goalId, 500),
    intent: compact(goal.intent || goal.objective || goal.description, 2000) || null,
    operation_keys: uniqueStrings(goal.operation_keys || goal.operation_key, 191),
    resource_refs: uniqueStrings([
      ...(Array.isArray(goal.resource_refs) ? goal.resource_refs : []),
      goal.resource_ref,
      goal.resource_uri,
    ], 1000),
    container_keys: uniqueStrings(goal.container_keys || goal.container_key, 300),
    tenant_id: compact(goal.tenant_id, 191) || null,
    workspace_id: compact(goal.workspace_id, 191) || null,
    brand_keys: uniqueStrings(goal.brand_keys || goal.brand_key, 191),
    system_ids: uniqueStrings(goal.system_ids || goal.system_id, 191),
    tags: uniqueStrings(goal.tags, 100),
    dependency_refs: uniqueStrings(goal.dependency_refs, 1000),
    secrets_included: false,
  };
  if (!normalized.operation_keys.length
      && !normalized.resource_refs.length
      && !normalized.container_keys.length
      && !normalized.workspace_id
      && !normalized.brand_keys.length
      && !normalized.system_ids.length
      && !normalized.tags.length) {
    throw intelligenceError(
      "GOAL_CORRELATION_ANCHOR_REQUIRED",
      "Goal correlation requires at least one operation, resource, container, workspace, Brand, system, or tag anchor.",
      { goal_id: goalId },
    );
  }
  return Object.freeze({ ...normalized, goal_fingerprint_sha256: sha256(normalized) });
}

function normalizeOperation(operation = {}, index = 0) {
  assertSecretFree(operation, `operations[${index}]`);
  const operationId = compact(operation.operation_id || operation.run_id || operation.id, 191);
  if (!operationId) throw intelligenceError("GOAL_OPERATION_ID_REQUIRED", "Every operation snapshot requires an operation id.", { index });
  return Object.freeze({
    operation_id: operationId,
    operation_key: compact(operation.operation_key || operation.intent || operation.operation_intent, 191) || null,
    status: normalizeStatus(operation.status || operation.operation_status || operation.run_status),
    goal_refs: uniqueStrings([
      ...(Array.isArray(operation.goal_refs) ? operation.goal_refs : []),
      operation.goal_id,
      operation.goal_ref,
      ...(Array.isArray(operation.correlation_refs) ? operation.correlation_refs : []),
    ], 300),
    resource_refs: uniqueStrings([
      ...(Array.isArray(operation.resource_refs) ? operation.resource_refs : []),
      operation.resource_ref,
      operation.resource_uri,
    ], 1000),
    container_keys: uniqueStrings(operation.container_keys || operation.container_key, 300),
    tenant_id: compact(operation.tenant_id, 191) || null,
    workspace_id: compact(operation.workspace_id, 191) || null,
    brand_keys: uniqueStrings(operation.brand_keys || operation.brand_key, 191),
    system_ids: uniqueStrings(operation.system_ids || operation.system_id, 191),
    tags: uniqueStrings(operation.tags, 100),
    parent_operation_id: compact(operation.parent_operation_id || operation.parent_run_id, 191) || null,
    blockers: uniqueStrings(operation.blockers || operation.blocker_codes, 500),
    next_action: stable(operation.next_action || null),
    evidence_refs: uniqueStrings(operation.evidence_refs, 1000),
    updated_at: operation.updated_at ? new Date(operation.updated_at).toISOString() : null,
    raw: stable(operation),
    secrets_included: false,
  });
}

function scoreOperation(goal, operation) {
  const reasons = [];
  let score = 0;
  const explicitGoalRefs = intersection(operation.goal_refs, [goal.goal_id]);
  if (explicitGoalRefs.length) {
    score += 100;
    reasons.push("explicit_goal_reference");
  }
  const resourceMatches = intersection(operation.resource_refs, goal.resource_refs);
  if (resourceMatches.length) {
    score += 50;
    reasons.push("resource_ref_match");
  }
  const containerMatches = intersection(operation.container_keys, goal.container_keys);
  if (containerMatches.length) {
    score += 40;
    reasons.push("container_key_match");
  }
  if (goal.workspace_id && operation.workspace_id === goal.workspace_id) {
    score += 35;
    reasons.push("workspace_id_match");
  }
  const brandMatches = intersection(operation.brand_keys, goal.brand_keys);
  if (brandMatches.length) {
    score += 30;
    reasons.push("brand_key_match");
  }
  const systemMatches = intersection(operation.system_ids, goal.system_ids);
  if (systemMatches.length) {
    score += 30;
    reasons.push("system_id_match");
  }
  if (operation.operation_key && goal.operation_keys.includes(operation.operation_key)) {
    score += 20;
    reasons.push("operation_key_match");
  }
  const tagMatches = intersection(operation.tags, goal.tags);
  if (tagMatches.length) {
    score += 10;
    reasons.push("tag_match");
  }
  if (goal.tenant_id && operation.tenant_id === goal.tenant_id) {
    score += 5;
    reasons.push("tenant_scope_match");
  }
  const strongDimension = resourceMatches.length
    || containerMatches.length
    || brandMatches.length
    || systemMatches.length
    || (goal.workspace_id && operation.workspace_id === goal.workspace_id);
  const semanticPair = reasons.includes("operation_key_match") && reasons.includes("tag_match");
  return {
    score,
    reasons,
    explicit: explicitGoalRefs.length > 0,
    linked: explicitGoalRefs.length > 0 || (score >= 30 && Boolean(strongDimension || semanticPair)),
  };
}

function relationCompatible(left, right) {
  if (left.tenant_id && right.tenant_id && left.tenant_id !== right.tenant_id) return false;
  if (left.workspace_id && right.workspace_id && left.workspace_id !== right.workspace_id) return false;
  const leftResources = new Set(left.resource_refs);
  const rightResources = new Set(right.resource_refs);
  if (leftResources.size && rightResources.size && !right.resource_refs.some((ref) => leftResources.has(ref))) return false;
  return true;
}

function operationStatusRank(status) {
  if (BLOCKED_OPERATION_STATUSES.has(status)) return 0;
  if (APPROVAL_OPERATION_STATUSES.has(status)) return 1;
  if (ACTIVE_OPERATION_STATUSES.has(status)) return 2;
  if (!TERMINAL_OPERATION_STATUSES.has(status)) return 3;
  return 4;
}

export function correlateGoalToOperations(goalInput = {}, operationInputs = []) {
  const goal = normalizeGoal(goalInput);
  const operations = (Array.isArray(operationInputs) ? operationInputs : []).map(normalizeOperation);
  const byId = new Map(operations.map((operation) => [operation.operation_id, operation]));
  const correlations = new Map();

  for (const operation of operations) {
    const scored = scoreOperation(goal, operation);
    if (scored.linked) {
      correlations.set(operation.operation_id, {
        operation,
        correlation_class: scored.explicit ? "primary" : "supporting",
        correlation_score: scored.score,
        correlation_reasons: scored.reasons,
      });
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    let added = 0;
    for (const operation of operations) {
      if (correlations.has(operation.operation_id)) continue;
      const parent = operation.parent_operation_id ? correlations.get(operation.parent_operation_id)?.operation : null;
      const child = [...correlations.values()].find((entry) => entry.operation.parent_operation_id === operation.operation_id)?.operation || null;
      const relation = parent || child;
      if (!relation || !relationCompatible(operation, relation)) continue;
      correlations.set(operation.operation_id, {
        operation,
        correlation_class: "supporting",
        correlation_score: 25,
        correlation_reasons: [parent ? "parent_operation_link" : "child_operation_link"],
      });
      added += 1;
    }
    if (!added) break;
  }

  const linked = [...correlations.values()].sort((left, right) => {
    const statusDelta = operationStatusRank(left.operation.status) - operationStatusRank(right.operation.status);
    return statusDelta || right.correlation_score - left.correlation_score || left.operation.operation_id.localeCompare(right.operation.operation_id);
  });
  const unrelated = operations.filter((operation) => !correlations.has(operation.operation_id));
  const statuses = linked.map((entry) => entry.operation.status);
  const goalState = statuses.some((status) => BLOCKED_OPERATION_STATUSES.has(status))
    ? "blocked"
    : statuses.some((status) => APPROVAL_OPERATION_STATUSES.has(status))
      ? "attention_required"
      : statuses.some((status) => ACTIVE_OPERATION_STATUSES.has(status))
        ? "in_progress"
        : statuses.length && statuses.every((status) => TERMINAL_OPERATION_STATUSES.has(status))
          ? "completed"
          : statuses.length
            ? "unknown"
            : "not_started";

  return {
    goal,
    goal_state: goalState,
    linked_operations: linked,
    unrelated_operations: unrelated,
    summary: {
      total_operations: operations.length,
      linked_operations: linked.length,
      primary_operations: linked.filter((entry) => entry.correlation_class === "primary").length,
      supporting_operations: linked.filter((entry) => entry.correlation_class === "supporting").length,
      unrelated_operations: unrelated.length,
      blocked_operations: linked.filter((entry) => BLOCKED_OPERATION_STATUSES.has(entry.operation.status)).length,
      active_operations: linked.filter((entry) => ACTIVE_OPERATION_STATUSES.has(entry.operation.status)).length,
      approval_operations: linked.filter((entry) => APPROVAL_OPERATION_STATUSES.has(entry.operation.status)).length,
      completed_operations: linked.filter((entry) => TERMINAL_OPERATION_STATUSES.has(entry.operation.status)).length,
    },
    secrets_included: false,
  };
}

function normalizeAttentionItem(item = {}, index = 0) {
  assertSecretFree(item, `attention_queue[${index}]`);
  const evidence = item.evidence && typeof item.evidence === "object" ? item.evidence : {};
  const attentionId = compact(item.queue_key || item.attention_id || item.id, 300) || `attention-${index}`;
  return Object.freeze({
    attention_id: attentionId,
    severity: compact(item.severity || "info", 32).toLowerCase(),
    source: compact(item.source, 191) || null,
    reason_code: compact(item.reason_code, 191) || "unknown",
    title: compact(item.title, 1000) || attentionId,
    recommended_action_key: compact(item.recommended_action_key, 191) || null,
    requires_confirmation: item.requires_confirmation === true,
    blocking: item.blocking === true || item.blocker_level === "hard" || evidence.blocker_level === "hard",
    scope: compact(item.scope || evidence.scope || evidence.subject_scope, 64).toLowerCase() || null,
    container_keys: uniqueStrings([item.container_key, evidence.container_key, ...(Array.isArray(item.container_keys) ? item.container_keys : [])], 300),
    resource_refs: uniqueStrings([item.resource_ref, evidence.resource_ref, evidence.resource_uri, ...(Array.isArray(item.resource_refs) ? item.resource_refs : [])], 1000),
    tenant_id: compact(item.tenant_id || evidence.tenant_id, 191) || null,
    workspace_id: compact(item.workspace_id || evidence.workspace_id, 191) || null,
    brand_keys: uniqueStrings([item.brand_key, evidence.brand_key, ...(Array.isArray(item.brand_keys) ? item.brand_keys : [])], 191),
    system_ids: uniqueStrings([item.system_id, evidence.system_id, ...(Array.isArray(item.system_ids) ? item.system_ids : [])], 191),
    operation_refs: uniqueStrings([
      item.operation_id,
      item.run_id,
      evidence.operation_id,
      evidence.run_id,
      ...(Array.isArray(item.operation_refs) ? item.operation_refs : []),
    ], 191),
    evidence_refs: uniqueStrings([item.source_ref, evidence.source_ref, ...(Array.isArray(item.evidence_refs) ? item.evidence_refs : [])], 1000),
    raw: stable(item),
    secrets_included: false,
  });
}

function severityRank(severity) {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity] ?? 5;
}

function attentionMatchesGoal(goal, attention) {
  const reasons = [];
  if (intersection(attention.resource_refs, goal.resource_refs).length) reasons.push("resource_ref_match");
  if (intersection(attention.container_keys, goal.container_keys).length) reasons.push("container_key_match");
  if (goal.workspace_id && attention.workspace_id === goal.workspace_id) reasons.push("workspace_id_match");
  if (intersection(attention.brand_keys, goal.brand_keys).length) reasons.push("brand_key_match");
  if (intersection(attention.system_ids, goal.system_ids).length) reasons.push("system_id_match");
  return reasons;
}

export function classifyGoalAttention(goalInput, correlation, attentionInputs = []) {
  const goal = correlation?.goal || normalizeGoal(goalInput);
  const linkedIds = new Set((correlation?.linked_operations || []).map((entry) => entry.operation.operation_id));
  const items = (Array.isArray(attentionInputs) ? attentionInputs : []).map(normalizeAttentionItem);
  const classified = items.map((attention) => {
    const directOperationRefs = attention.operation_refs.filter((ref) => linkedIds.has(ref));
    const goalReasons = attentionMatchesGoal(goal, attention);
    const blockingSignal = attention.blocking
      || BLOCKING_REASON_PATTERN.test(attention.reason_code)
      || BLOCKING_REASON_PATTERN.test(attention.title)
      || (attention.severity === "critical" && attention.requires_confirmation);
    const platformWide = ["platform", "global", "platform_wide"].includes(attention.scope)
      || (attention.container_keys.length === 0 && !attention.tenant_id && attention.raw?.platform_wide === true);
    let classification = "unrelated";
    if ((directOperationRefs.length || goalReasons.length) && blockingSignal) classification = "blocking";
    else if (directOperationRefs.length || goalReasons.length) classification = "related_risk";
    else if (platformWide) classification = "platform_wide";
    if (!CLASS_SET.has(classification)) classification = "unrelated";
    return {
      attention,
      classification,
      goal_impact: classification === "blocking" || classification === "related_risk"
        ? "direct"
        : classification === "platform_wide"
          ? "potential"
          : "none",
      correlation_reasons: [
        ...goalReasons,
        ...(directOperationRefs.length ? ["linked_operation_reference"] : []),
        ...(platformWide ? ["platform_scope"] : []),
        ...(blockingSignal ? ["blocking_signal"] : []),
      ],
      linked_operation_ids: directOperationRefs,
    };
  });
  classified.sort((left, right) => {
    const classRank = { blocking: 0, related_risk: 1, platform_wide: 2, unrelated: 3 };
    return classRank[left.classification] - classRank[right.classification]
      || severityRank(left.attention.severity) - severityRank(right.attention.severity)
      || left.attention.attention_id.localeCompare(right.attention.attention_id);
  });
  return {
    items: classified,
    buckets: Object.fromEntries(GOAL_ATTENTION_CLASSES.map((classification) => [
      classification,
      classified.filter((entry) => entry.classification === classification),
    ])),
    counts: Object.fromEntries(GOAL_ATTENTION_CLASSES.map((classification) => [
      classification,
      classified.filter((entry) => entry.classification === classification).length,
    ])),
    secrets_included: false,
  };
}

function normalizedLimits(input = {}) {
  const output = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const parsed = Number(input[key]);
    const max = key === "max_summary_bytes" ? 256 * 1024 : 25;
    const min = key === "max_summary_bytes" ? 4096 : 0;
    output[key] = Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
  }
  return output;
}

function detailDescriptor(kind, id, subject, payload, sourceRefs = []) {
  const digest = sha256(payload);
  return {
    kind,
    item_id: id,
    subject,
    digest_sha256: digest,
    source_refs: uniqueStrings(sourceRefs, 1000),
    payload: stable(payload),
    secrets_included: false,
  };
}

async function registerDetail(registrar, descriptor) {
  const result = await registrar(descriptor);
  assertSecretFree(result, `diagnostic_reference:${descriptor.kind}:${descriptor.item_id}`);
  const reference = compact(result?.reference || result?.ref, 1000);
  const readToolKey = compact(result?.read_tool_key || result?.tool_key, 191);
  const digest = compact(result?.digest_sha256, 64).toLowerCase();
  if (!REFERENCE_PATTERN.test(reference)
      || !readToolKey
      || digest !== descriptor.digest_sha256
      || result?.secrets_included !== false) {
    throw intelligenceError("GOAL_DIAGNOSTIC_REFERENCE_INVALID", "Diagnostic registrar returned an invalid governed reference.", {
      kind: descriptor.kind,
      item_id: descriptor.item_id,
    });
  }
  return Object.freeze({
    reference,
    read_tool_key: readToolKey,
    digest_sha256: digest,
    item_id: descriptor.item_id,
    kind: descriptor.kind,
    secrets_included: false,
  });
}

function operationInline(entry, reference) {
  return {
    operation_id: entry.operation.operation_id,
    operation_key: entry.operation.operation_key,
    status: entry.operation.status,
    correlation_class: entry.correlation_class,
    correlation_score: entry.correlation_score,
    correlation_reasons: entry.correlation_reasons,
    blockers: entry.operation.blockers.slice(0, 5),
    next_action: entry.operation.next_action,
    diagnostic_ref: reference,
    secrets_included: false,
  };
}

function attentionInline(entry, reference) {
  return {
    attention_id: entry.attention.attention_id,
    classification: entry.classification,
    goal_impact: entry.goal_impact,
    severity: entry.attention.severity,
    source: entry.attention.source,
    reason_code: entry.attention.reason_code,
    title: entry.attention.title,
    recommended_action_key: entry.attention.recommended_action_key,
    requires_confirmation: entry.attention.requires_confirmation,
    correlation_reasons: entry.correlation_reasons,
    linked_operation_ids: entry.linked_operation_ids,
    diagnostic_ref: reference,
    secrets_included: false,
  };
}

function uniqueActions(correlation, attention, limit) {
  const actions = [];
  for (const entry of correlation.linked_operations) {
    const action = entry.operation.next_action;
    if (!action) continue;
    actions.push(typeof action === "string" ? { action_key: compact(action, 191) } : stable(action));
  }
  for (const entry of attention.items) {
    if (!entry.attention.recommended_action_key) continue;
    actions.push({
      action_key: entry.attention.recommended_action_key,
      source: entry.attention.attention_id,
      requires_confirmation: entry.attention.requires_confirmation,
    });
  }
  const seen = new Set();
  return actions.filter((action) => {
    const key = sha256(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function uniqueBlockers(correlation, attention, limit) {
  const blockers = [];
  for (const entry of correlation.linked_operations) {
    for (const blocker of entry.operation.blockers) blockers.push({ source: entry.operation.operation_id, blocker });
  }
  for (const entry of attention.buckets.blocking) {
    blockers.push({ source: entry.attention.attention_id, blocker: entry.attention.reason_code, severity: entry.attention.severity });
  }
  const seen = new Set();
  return blockers.filter((entry) => {
    const key = `${entry.source}:${entry.blocker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export async function buildGoalFilteredOperationalIntelligence({
  goal,
  operations = null,
  operational_intelligence = null,
  session_context = null,
  limits = {},
} = {}, deps = {}) {
  const normalizedGoal = normalizeGoal(goal);
  const operationRows = operations ?? (typeof deps.readOperations === "function"
    ? await deps.readOperations({ goal: normalizedGoal, secrets_included: false })
    : null);
  if (!Array.isArray(operationRows)) {
    throw intelligenceError("GOAL_OPERATION_READER_REQUIRED", "Durable operation snapshots are required.");
  }
  const operational = operational_intelligence ?? (typeof deps.buildOperationalIntelligence === "function"
    ? await deps.buildOperationalIntelligence({ sessionContext: session_context })
    : await buildActivationOperationalIntelligenceEvidence({ sessionContext: session_context }));
  assertSecretFree(operational, "operational_intelligence");
  const registrar = deps.registerDiagnosticReference;
  if (typeof registrar !== "function") {
    throw intelligenceError("GOAL_DIAGNOSTIC_REGISTRAR_REQUIRED", "A governed diagnostic reference registrar is required.");
  }

  const correlation = correlateGoalToOperations(normalizedGoal, operationRows);
  const attention = classifyGoalAttention(
    normalizedGoal,
    correlation,
    Array.isArray(operational?.attention_queue) ? operational.attention_queue : [],
  );
  const policyLimits = normalizedLimits(limits);
  const operationReferences = new Map();
  for (const entry of [...correlation.linked_operations, ...correlation.unrelated_operations.map((operation) => ({ operation }))]) {
    const operation = entry.operation;
    const descriptor = detailDescriptor(
      "operation",
      operation.operation_id,
      normalizedGoal.goal_id,
      operation.raw,
      operation.evidence_refs,
    );
    operationReferences.set(operation.operation_id, await registerDetail(registrar, descriptor));
  }
  const attentionReferences = new Map();
  for (const entry of attention.items) {
    const descriptor = detailDescriptor(
      "attention",
      entry.attention.attention_id,
      normalizedGoal.goal_id,
      entry.attention.raw,
      entry.attention.evidence_refs,
    );
    attentionReferences.set(entry.attention.attention_id, await registerDetail(registrar, descriptor));
  }

  const linkedInline = correlation.linked_operations
    .slice(0, policyLimits.linked_operations)
    .map((entry) => operationInline(entry, operationReferences.get(entry.operation.operation_id)));
  const attentionInlineBuckets = {
    blocking: attention.buckets.blocking.slice(0, policyLimits.blocking)
      .map((entry) => attentionInline(entry, attentionReferences.get(entry.attention.attention_id))),
    related_risk: attention.buckets.related_risk.slice(0, policyLimits.related_risk)
      .map((entry) => attentionInline(entry, attentionReferences.get(entry.attention.attention_id))),
    platform_wide: attention.buckets.platform_wide.slice(0, policyLimits.platform_wide)
      .map((entry) => attentionInline(entry, attentionReferences.get(entry.attention.attention_id))),
  };
  const operationDetailRefs = [...operationReferences.values()];
  const attentionDetailRefs = [...attentionReferences.values()];
  const projectionBase = {
    schema_version: 1,
    version: SPEC011_GOAL_FILTERED_INTELLIGENCE_VERSION,
    generated_at: new Date().toISOString(),
    goal: {
      goal_id: normalizedGoal.goal_id,
      title: normalizedGoal.title,
      intent: normalizedGoal.intent,
      goal_fingerprint_sha256: normalizedGoal.goal_fingerprint_sha256,
      state: correlation.goal_state,
    },
    summary: {
      ...correlation.summary,
      attention_total: attention.items.length,
      attention_by_class: attention.counts,
      inline_linked_operations: linkedInline.length,
      inline_attention: Object.values(attentionInlineBuckets).reduce((sum, rows) => sum + rows.length, 0),
      full_diagnostic_operation_count: operationDetailRefs.length,
      full_diagnostic_attention_count: attentionDetailRefs.length,
      degraded_operational_surface_count: Array.isArray(operational?.degraded_surfaces) ? operational.degraded_surfaces.length : 0,
    },
    blockers: uniqueBlockers(correlation, attention, policyLimits.blockers),
    next_actions: uniqueActions(correlation, attention, policyLimits.next_actions),
    linked_operations: linkedInline,
    attention: attentionInlineBuckets,
    detail_references: {
      operations: operationDetailRefs,
      attention: attentionDetailRefs,
      unrelated_attention: attention.buckets.unrelated.map((entry) => attentionReferences.get(entry.attention.attention_id)),
      unrelated_operations: correlation.unrelated_operations.map((operation) => operationReferences.get(operation.operation_id)),
    },
    source_health: {
      activation_operational_intelligence_ok: operational?.ok === true,
      activation_layer: compact(operational?.activation_layer, 191) || null,
      source_authority: compact(operational?.source_authority, 500) || null,
      degraded_surfaces: (Array.isArray(operational?.degraded_surfaces) ? operational.degraded_surfaces : []).map((entry) => ({
        surface: compact(entry?.surface, 191),
        diagnostic_ref_required: true,
      })),
    },
    completeness: {
      summary_first: true,
      full_diagnostic_detail_inline: false,
      every_operation_has_governed_reference: operationDetailRefs.length === operationRows.length,
      every_attention_item_has_governed_reference: attentionDetailRefs.length === attention.items.length,
      unrelated_items_counted_not_discarded: true,
      complete: operationDetailRefs.length === operationRows.length && attentionDetailRefs.length === attention.items.length,
    },
    policy: {
      exact_correlation_only: true,
      tenant_only_match_is_insufficient: true,
      unrelated_attention_not_inlined: true,
      full_diagnostics_preserved_by_governed_reference: true,
      response_is_read_only: true,
      provider_calls_made: false,
      external_mutations_executed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
  const serialized = JSON.stringify(projectionBase);
  if (Buffer.byteLength(serialized) > policyLimits.max_summary_bytes) {
    throw intelligenceError("GOAL_INTELLIGENCE_SUMMARY_UNBOUNDED", "Goal-filtered projection exceeds the configured summary bound.", {
      bytes: Buffer.byteLength(serialized),
      max_summary_bytes: policyLimits.max_summary_bytes,
    });
  }
  assertSecretFree(projectionBase, "projection");
  return Object.freeze({
    ...projectionBase,
    projection_fingerprint_sha256: sha256(projectionBase),
  });
}

export const _testingSpec011GoalFilteredOperationalIntelligence = {
  stable,
  sha256,
  assertSecretFree,
  normalizeGoal,
  normalizeOperation,
  normalizeAttentionItem,
  scoreOperation,
  relationCompatible,
  detailDescriptor,
  normalizedLimits,
};
