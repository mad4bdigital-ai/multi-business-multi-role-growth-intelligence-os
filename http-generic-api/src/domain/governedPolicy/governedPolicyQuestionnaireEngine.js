import { createHash, randomUUID } from "node:crypto";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session[_-]?token)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_JSON_BYTES = 262_144;
const MAX_QUESTIONS = 200;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4_000;

export const GOVERNED_POLICY_INTERACTION_MODES = Object.freeze(["guided", "advanced", "expert_governed"]);
export const GOVERNED_POLICY_RISK_TIERS = Object.freeze(["low", "medium", "high", "critical"]);
export const GOVERNED_POLICY_APPROVAL_CLASSES = Object.freeze({
  low: "tenant_owner_confirmation",
  medium: "designated_owner_approval",
  high: "platform_admin_approval",
  critical: "platform_admin_typed_confirmation",
});
export const GOVERNED_POLICY_ANSWER_TYPES = Object.freeze([
  "boolean", "enum", "integer", "number", "string", "multi_select", "object",
]);

export class GovernedPolicyError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message);
    this.name = "GovernedPolicyError";
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, status = 422, details = {}) {
  throw new GovernedPolicyError(code, message, status, details);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableNormalize(value) {
  if (value === undefined) return { __governed_policy_undefined__: true };
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableNormalize(value[key])]));
}

export function stableGovernedPolicySha256(value) {
  return createHash("sha256").update(JSON.stringify(stableNormalize(value)), "utf8").digest("hex");
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) fail("governed_policy_invalid_key", `${field} must be a canonical key.`, 422, { field });
  return normalized;
}

function identifier(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("governed_policy_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  }
  return normalized;
}

function explicitVersion(value, field) {
  const normalized = String(value ?? "").trim();
  if (!VERSION_RE.test(normalized)) fail("governed_policy_invalid_version", `${field} must be an explicit bounded version.`, 422, { field });
  return normalized;
}

function instant(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail("governed_policy_invalid_instant", `${field} must be a valid instant.`, 422, { field });
  return date.toISOString();
}

function boundedInteger(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("governed_policy_value_out_of_bounds", `${field} is outside the supported integer bounds.`, 422, { field, minimum, maximum });
  }
  return normalized;
}

function boundedNumber(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail("governed_policy_value_out_of_bounds", `${field} is outside the supported numeric bounds.`, 422, { field, minimum, maximum });
  }
  return normalized;
}

function assertBoundedJson(value, field, maximumBytes = MAX_JSON_BYTES) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("governed_policy_not_json_serializable", `${field} must be JSON serializable.`, 422, { field });
  }
  const bytes = Buffer.byteLength(serialized ?? "", "utf8");
  if (bytes > maximumBytes) fail("governed_policy_json_oversized", `${field} exceeds the supported byte bound.`, 413, { field, maximum_bytes: maximumBytes, observed_bytes: bytes });
}

function assertSensitiveFree(value, field = "value", depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) fail("governed_policy_sensitive_value", `${field} contains a forbidden secret-like value.`, 422, { field });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) fail("governed_policy_sensitive_field", `${field}.${key} is forbidden.`, 422, { field: `${field}.${key}` });
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function uniqueArray(values, field, normalize = canonical, maximum = MAX_ARRAY_ITEMS) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > maximum) fail("governed_policy_invalid_array", `${field} must be a bounded array.`, 422, { field, maximum });
  return [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
}

function normalizeVisibilityRule(source, field) {
  if (source == null) return null;
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("governed_policy_invalid_visibility_rule", `${field} must be an object.`, 422, { field });
  const mode = String(source.mode ?? "all").trim().toLowerCase();
  if (!new Set(["all", "any"]).has(mode)) fail("governed_policy_invalid_visibility_rule", `${field}.mode is unsupported.`, 422, { field: `${field}.mode` });
  const conditions = Array.isArray(source.conditions) ? source.conditions : [];
  if (conditions.length === 0 || conditions.length > 20) fail("governed_policy_invalid_visibility_rule", `${field}.conditions must be a non-empty bounded array.`, 422, { field: `${field}.conditions` });
  return deepFreeze({
    mode,
    conditions: conditions.map((condition, index) => {
      const conditionField = `${field}.conditions[${index}]`;
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) fail("governed_policy_invalid_visibility_rule", `${conditionField} must be an object.`, 422, { field: conditionField });
      const sourceType = String(condition.source ?? "answer").trim().toLowerCase();
      if (!new Set(["answer", "context", "role", "mode"]).has(sourceType)) fail("governed_policy_invalid_visibility_rule", `${conditionField}.source is unsupported.`, 422, { field: `${conditionField}.source` });
      const operator = String(condition.operator ?? "equals").trim().toLowerCase();
      if (!new Set(["equals", "not_equals", "in", "not_in", "exists", "contains"]).has(operator)) fail("governed_policy_invalid_visibility_rule", `${conditionField}.operator is unsupported.`, 422, { field: `${conditionField}.operator` });
      assertSensitiveFree(condition.value, `${conditionField}.value`);
      return {
        source: sourceType,
        key: sourceType === "answer" || sourceType === "context"
          ? canonical(condition.key, `${conditionField}.key`)
          : String(condition.key ?? sourceType).trim().toLowerCase(),
        operator,
        value: cloneJson(condition.value),
      };
    }),
  });
}

function normalizeQuestion(source, index) {
  const field = `questions[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("governed_policy_invalid_question", `${field} must be an object.`, 422, { field });
  const answerType = String(source.answer_type ?? source.answerType ?? "string").trim().toLowerCase();
  if (!GOVERNED_POLICY_ANSWER_TYPES.includes(answerType)) fail("governed_policy_invalid_question", `${field}.answer_type is unsupported.`, 422, { field: `${field}.answer_type` });
  const allowedValues = source.allowed_values ?? source.allowedValues ?? null;
  if (allowedValues != null && (!Array.isArray(allowedValues) || allowedValues.length > MAX_ARRAY_ITEMS)) fail("governed_policy_invalid_question", `${field}.allowed_values must be bounded.`, 422, { field: `${field}.allowed_values` });
  const constraints = source.constraints == null ? {} : cloneJson(source.constraints);
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) fail("governed_policy_invalid_question", `${field}.constraints must be an object.`, 422, { field: `${field}.constraints` });
  assertSensitiveFree({ allowedValues, constraints }, field);
  return deepFreeze({
    question_key: canonical(source.question_key ?? source.questionKey, `${field}.question_key`),
    label: String(source.label ?? source.question_key ?? source.questionKey).slice(0, 512),
    description: source.description == null ? null : String(source.description).slice(0, 2000),
    answer_type: answerType,
    allowed_values: allowedValues == null ? null : cloneJson(allowedValues),
    constraints,
    required: source.required === true,
    visibility_rule: normalizeVisibilityRule(source.visibility_rule ?? source.visibilityRule, `${field}.visibility_rule`),
    dependency_questions: uniqueArray(source.dependency_questions ?? source.dependencyQuestions, `${field}.dependency_questions`),
    risk_weight: source.risk_weight == null ? 0 : boundedNumber(source.risk_weight, `${field}.risk_weight`, 0, 100),
    default_strategy_key: source.default_strategy_key == null ? null : canonical(source.default_strategy_key, `${field}.default_strategy_key`),
  });
}

export function normalizeQuestionnaireDefinition(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("governed_policy_invalid_definition", "definition must be an object.");
  assertBoundedJson(source, "definition");
  assertSensitiveFree(source, "definition");
  const rawQuestions = Array.isArray(source.questions) ? source.questions : [];
  if (rawQuestions.length === 0 || rawQuestions.length > MAX_QUESTIONS) fail("governed_policy_invalid_definition", "definition.questions must be non-empty and bounded.");
  const questions = rawQuestions.map(normalizeQuestion);
  const keys = questions.map((question) => question.question_key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) fail("governed_policy_duplicate_question", "Question keys must be unique.", 409, { question_keys: [...new Set(duplicates)].sort() });
  const status = String(source.status ?? "active").trim().toLowerCase();
  if (!new Set(["draft", "active", "deprecated", "disabled", "expired"]).has(status)) fail("governed_policy_invalid_definition", "definition.status is unsupported.");
  const definition = {
    questionnaire_key: canonical(source.questionnaire_key ?? source.questionnaireKey, "definition.questionnaire_key"),
    version: explicitVersion(source.version, "definition.version"),
    domain_key: canonical(source.domain_key ?? source.domainKey, "definition.domain_key"),
    purpose_key: canonical(source.purpose_key ?? source.purposeKey, "definition.purpose_key"),
    applicable_actor_roles: uniqueArray(source.applicable_actor_roles ?? source.applicableActorRoles, "definition.applicable_actor_roles"),
    interaction_modes: uniqueArray(source.interaction_modes ?? source.interactionModes ?? ["guided"], "definition.interaction_modes", (value, field) => {
      const mode = String(value ?? "").trim().toLowerCase();
      if (!GOVERNED_POLICY_INTERACTION_MODES.includes(mode)) fail("governed_policy_invalid_definition", `${field} is unsupported.`, 422, { field });
      return mode;
    }),
    context_rule_key: source.context_rule_key == null ? null : canonical(source.context_rule_key, "definition.context_rule_key"),
    policy_template_key: canonical(source.policy_template_key ?? source.policyTemplateKey, "definition.policy_template_key"),
    policy_template_version: explicitVersion(source.policy_template_version ?? source.policyTemplateVersion, "definition.policy_template_version"),
    compiler_key: canonical(source.compiler_key ?? source.compilerKey, "definition.compiler_key"),
    compiler_version: explicitVersion(source.compiler_version ?? source.compilerVersion, "definition.compiler_version"),
    impact_model_key: canonical(source.impact_model_key ?? source.impactModelKey, "definition.impact_model_key"),
    impact_model_version: explicitVersion(source.impact_model_version ?? source.impactModelVersion, "definition.impact_model_version"),
    approval_policy_key: canonical(source.approval_policy_key ?? source.approvalPolicyKey, "definition.approval_policy_key"),
    approval_policy_version: explicitVersion(source.approval_policy_version ?? source.approvalPolicyVersion, "definition.approval_policy_version"),
    status,
    effective_at: instant(source.effective_at ?? source.effectiveAt, "definition.effective_at"),
    expires_at: instant(source.expires_at ?? source.expiresAt, "definition.expires_at", { nullable: true }),
    questions,
    secrets_included: false,
  };
  return deepFreeze({ ...definition, definition_sha256: stableGovernedPolicySha256(definition) });
}

function observedValue(condition, state) {
  if (condition.source === "answer") return state.answers[condition.key];
  if (condition.source === "context") return state.context[condition.key];
  if (condition.source === "role") return state.actorRoles;
  if (condition.source === "mode") return state.interactionMode;
  return undefined;
}

function equal(left, right) {
  return stableGovernedPolicySha256(left) === stableGovernedPolicySha256(right);
}

function matches(condition, state) {
  const observed = observedValue(condition, state);
  if (condition.operator === "exists") return condition.value === false ? observed === undefined || observed === null : observed !== undefined && observed !== null;
  if (condition.operator === "equals") return observed !== undefined && equal(observed, condition.value);
  if (condition.operator === "not_equals") return observed === undefined || !equal(observed, condition.value);
  if (condition.operator === "in") return observed !== undefined && Array.isArray(condition.value) && condition.value.some((candidate) => equal(candidate, observed));
  if (condition.operator === "not_in") return observed === undefined || (Array.isArray(condition.value) && !condition.value.some((candidate) => equal(candidate, observed)));
  if (condition.operator === "contains") return Array.isArray(observed) && observed.some((candidate) => equal(candidate, condition.value));
  return false;
}

function visible(question, state) {
  if (!question.visibility_rule) return true;
  const results = question.visibility_rule.conditions.map((condition) => matches(condition, state));
  return question.visibility_rule.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

export function selectGovernedPolicyQuestions({ definition, answers = {}, context = {}, actorRoles = [], interactionMode }) {
  const normalized = definition?.definition_sha256 ? definition : normalizeQuestionnaireDefinition(definition);
  const mode = String(interactionMode ?? normalized.interaction_modes[0]).trim().toLowerCase();
  if (!normalized.interaction_modes.includes(mode)) fail("governed_policy_interaction_mode_not_allowed", "Interaction mode is not allowed.", 403);
  const roles = uniqueArray(actorRoles, "actorRoles");
  if (normalized.applicable_actor_roles.length > 0 && !roles.some((role) => normalized.applicable_actor_roles.includes(role))) fail("governed_policy_actor_not_eligible", "Actor is not eligible for the questionnaire.", 403);
  assertBoundedJson({ answers, context }, "selection_input");
  assertSensitiveFree({ answers, context }, "selection_input");
  return deepFreeze(normalized.questions.filter((question) => visible(question, { answers, context, actorRoles: roles, interactionMode: mode })).map((question) => ({ ...question })));
}

export function createPinnedQuestionnaireSession({ definition, tenantId, userId, actorRoles = [], interactionMode, context = {}, now = new Date(), ttlSeconds = 3600, sessionId = randomUUID() } = {}) {
  const normalized = definition?.definition_sha256 ? definition : normalizeQuestionnaireDefinition(definition);
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) fail("governed_policy_invalid_instant", "now must be valid.");
  if (normalized.status !== "active" || new Date(normalized.effective_at).getTime() > current.getTime() || (normalized.expires_at && new Date(normalized.expires_at).getTime() <= current.getTime())) fail("governed_policy_definition_not_effective", "Questionnaire definition is not active/effective.", 409);
  const mode = String(interactionMode ?? normalized.interaction_modes[0]).trim().toLowerCase();
  const roles = uniqueArray(actorRoles, "actorRoles");
  selectGovernedPolicyQuestions({ definition: normalized, answers: {}, context, actorRoles: roles, interactionMode: mode });
  const ttl = boundedInteger(ttlSeconds, "ttlSeconds", 60, 86400);
  const session = {
    session_id: identifier(sessionId, "sessionId"),
    tenant_id: identifier(tenantId, "tenantId"),
    user_id: identifier(userId, "userId"),
    questionnaire_key: normalized.questionnaire_key,
    questionnaire_version: normalized.version,
    definition_sha256: normalized.definition_sha256,
    domain_key: normalized.domain_key,
    purpose_key: normalized.purpose_key,
    interaction_mode: mode,
    actor_roles: roles,
    context_snapshot: cloneJson(context),
    status: "open",
    revision: 1,
    created_at: current.toISOString(),
    expires_at: new Date(current.getTime() + ttl * 1000).toISOString(),
    secrets_included: false,
  };
  return deepFreeze({ ...session, session_binding_sha256: stableGovernedPolicySha256(session) });
}

function normalizeAnswer(question, value, field) {
  const constraints = question.constraints ?? {};
  if (question.answer_type === "boolean") {
    if (typeof value !== "boolean") fail("governed_policy_answer_invalid", `${field} must be boolean.`, 422, { field });
    return value;
  }
  if (question.answer_type === "integer") return boundedInteger(value, field, Number.isFinite(Number(constraints.minimum)) ? Number(constraints.minimum) : -1e9, Number.isFinite(Number(constraints.maximum)) ? Number(constraints.maximum) : 1e9);
  if (question.answer_type === "number") return boundedNumber(value, field, Number.isFinite(Number(constraints.minimum)) ? Number(constraints.minimum) : -1e9, Number.isFinite(Number(constraints.maximum)) ? Number(constraints.maximum) : 1e9);
  if (question.answer_type === "enum") {
    const match = question.allowed_values?.find((candidate) => equal(candidate, value));
    if (match === undefined) fail("governed_policy_answer_invalid", `${field} is not allowed.`, 422, { field });
    return cloneJson(match);
  }
  if (question.answer_type === "multi_select") {
    if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) fail("governed_policy_answer_invalid", `${field} must be a bounded array.`, 422, { field });
    const normalized = [];
    for (const candidate of value) {
      const match = question.allowed_values?.find((allowed) => equal(allowed, candidate));
      if (match === undefined) fail("governed_policy_answer_invalid", `${field} contains an unsupported value.`, 422, { field });
      if (!normalized.some((existing) => equal(existing, match))) normalized.push(cloneJson(match));
    }
    const min = Number.isSafeInteger(Number(constraints.minimum_items)) ? Number(constraints.minimum_items) : 0;
    const max = Number.isSafeInteger(Number(constraints.maximum_items)) ? Number(constraints.maximum_items) : MAX_ARRAY_ITEMS;
    if (normalized.length < min || normalized.length > max) fail("governed_policy_answer_invalid", `${field} has invalid cardinality.`, 422, { field, minimum_items: min, maximum_items: max });
    return normalized.sort((left, right) => JSON.stringify(stableNormalize(left)).localeCompare(JSON.stringify(stableNormalize(right))));
  }
  if (question.answer_type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("governed_policy_answer_invalid", `${field} must be an object.`, 422, { field });
    assertBoundedJson(value, field, Number(constraints.maximum_bytes) || 32768);
    return cloneJson(value);
  }
  if (typeof value !== "string") fail("governed_policy_answer_invalid", `${field} must be a string.`, 422, { field });
  const text = constraints.trim === false ? value : value.trim();
  const min = Number.isSafeInteger(Number(constraints.minimum_length)) ? Number(constraints.minimum_length) : 0;
  const max = Number.isSafeInteger(Number(constraints.maximum_length)) ? Math.min(Number(constraints.maximum_length), MAX_STRING_LENGTH) : MAX_STRING_LENGTH;
  if (text.length < min || text.length > max) fail("governed_policy_answer_invalid", `${field} has invalid length.`, 422, { field, minimum_length: min, maximum_length: max });
  if (constraints.pattern) {
    let pattern;
    try { pattern = new RegExp(String(constraints.pattern)); } catch { fail("governed_policy_definition_invalid", `${question.question_key} pattern is invalid.`, 500); }
    if (!pattern.test(text)) fail("governed_policy_answer_invalid", `${field} does not match the required pattern.`, 422, { field });
  }
  return text;
}

export function validateQuestionnaireAnswers({ session, definition, answers = {} } = {}) {
  const normalized = definition?.definition_sha256 ? definition : normalizeQuestionnaireDefinition(definition);
  if (!session || session.questionnaire_key !== normalized.questionnaire_key || session.questionnaire_version !== normalized.version || session.definition_sha256 !== normalized.definition_sha256) fail("governed_policy_session_definition_drift", "Session is not pinned to the supplied definition.", 409);
  if (new Date(session.expires_at).getTime() <= Date.now()) fail("governed_policy_session_expired", "Session has expired.", 409);
  if (!new Set(["open", "ready_for_preview"]).has(session.status)) fail("governed_policy_session_not_editable", "Session is not editable.", 409, { status: session.status });
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length > MAX_QUESTIONS) fail("governed_policy_answers_invalid", "answers must be a bounded object.");
  assertBoundedJson(answers, "answers");
  assertSensitiveFree(answers, "answers");
  const visibleQuestions = selectGovernedPolicyQuestions({ definition: normalized, answers, context: session.context_snapshot, actorRoles: session.actor_roles, interactionMode: session.interaction_mode });
  const visibleByKey = new Map(visibleQuestions.map((question) => [question.question_key, question]));
  const unknown = Object.keys(answers).filter((key) => !visibleByKey.has(key));
  if (unknown.length > 0) fail("governed_policy_answer_not_visible", "Answers target hidden or unknown questions.", 422, { question_keys: unknown.sort() });
  const missing = visibleQuestions.filter((question) => question.required && !Object.hasOwn(answers, question.question_key)).map((question) => question.question_key);
  if (missing.length > 0) fail("governed_policy_required_answers_missing", "Required visible questions are unanswered.", 422, { question_keys: missing.sort() });
  const normalizedAnswers = Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, normalizeAnswer(visibleByKey.get(key), value, `answers.${key}`)]));
  const evidence = {
    session_id: session.session_id,
    session_binding_sha256: session.session_binding_sha256,
    questionnaire_key: normalized.questionnaire_key,
    questionnaire_version: normalized.version,
    definition_sha256: normalized.definition_sha256,
    answers: normalizedAnswers,
    visible_question_keys: visibleQuestions.map((question) => question.question_key).sort(),
    secrets_included: false,
  };
  return deepFreeze({ ...evidence, normalized_answers_sha256: stableGovernedPolicySha256(evidence) });
}

function normalizeSafetyBounds(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) fail("governed_policy_safety_bounds_required", "safetyBounds must be an object.");
  assertBoundedJson(source, "safetyBounds");
  assertSensitiveFree(source, "safetyBounds");
  const normalized = {
    safety_bounds_key: canonical(source.safety_bounds_key ?? source.safetyBoundsKey, "safetyBounds.safety_bounds_key"),
    version: explicitVersion(source.version, "safetyBounds.version"),
    domain_key: canonical(source.domain_key ?? source.domainKey, "safetyBounds.domain_key"),
    immutable_rules: uniqueArray(source.immutable_rules ?? source.immutableRules, "safetyBounds.immutable_rules"),
    configurable_fields: cloneJson(source.configurable_fields ?? source.configurableFields ?? {}),
    risk_matrix: cloneJson(source.risk_matrix ?? source.riskMatrix ?? {}),
    status: String(source.status ?? "active").trim().toLowerCase(),
  };
  if (normalized.status !== "active") fail("governed_policy_safety_bounds_not_active", "Safety bounds must be active.", 409);
  return deepFreeze({ ...normalized, safety_bounds_sha256: source.safety_bounds_sha256 ?? stableGovernedPolicySha256(normalized) });
}

function validateAdapter(adapter, definition) {
  if (!adapter || canonical(adapter.key, "adapter.key") !== definition.compiler_key || explicitVersion(adapter.version, "adapter.version") !== definition.compiler_version) fail("governed_policy_compiler_version_mismatch", "Adapter key/version does not match the pinned definition.", 409);
  for (const method of ["compilePolicy", "validatePolicy", "assessRisk", "buildImpactPreview"]) if (typeof adapter[method] !== "function") fail("governed_policy_domain_adapter_invalid", `adapter.${method} is required.`, 500);
  return adapter;
}

export function compileGovernedPolicyProposal({ session, definition, answers, safetyBounds, adapter, resourceUri, proposedVersion, now = new Date(), proposalId = randomUUID() } = {}) {
  const normalizedDefinition = definition?.definition_sha256 ? definition : normalizeQuestionnaireDefinition(definition);
  const validated = validateQuestionnaireAnswers({ session, definition: normalizedDefinition, answers });
  const bounds = normalizeSafetyBounds(safetyBounds);
  if (bounds.domain_key !== normalizedDefinition.domain_key) fail("governed_policy_safety_bounds_domain_mismatch", "Safety bounds domain does not match.", 409);
  const compiler = validateAdapter(adapter, normalizedDefinition);
  const resource = String(resourceUri ?? "").trim();
  try {
    const parsed = new URL(resource);
    if (!new Set(["https:", "urn:"]).has(parsed.protocol)) throw new Error("unsupported");
  } catch {
    fail("governed_policy_resource_invalid", "resourceUri must be an absolute https or urn URI.", 422);
  }
  const createdAt = instant(now, "now");
  const input = deepFreeze({
    questionnaire: { key: normalizedDefinition.questionnaire_key, version: normalizedDefinition.version, definition_sha256: normalizedDefinition.definition_sha256 },
    template: { key: normalizedDefinition.policy_template_key, version: normalizedDefinition.policy_template_version },
    compiler: { key: normalizedDefinition.compiler_key, version: normalizedDefinition.compiler_version },
    impact_model: { key: normalizedDefinition.impact_model_key, version: normalizedDefinition.impact_model_version },
    approval_policy: { key: normalizedDefinition.approval_policy_key, version: normalizedDefinition.approval_policy_version },
    safety_bounds: { key: bounds.safety_bounds_key, version: bounds.version, sha256: bounds.safety_bounds_sha256 },
    session: { id: session.session_id, binding_sha256: session.session_binding_sha256, tenant_id: session.tenant_id, user_id: session.user_id, context_snapshot: cloneJson(session.context_snapshot), interaction_mode: session.interaction_mode, actor_roles: [...session.actor_roles] },
    normalized_answers: cloneJson(validated.answers),
    normalized_answers_sha256: validated.normalized_answers_sha256,
  });
  const policy = compiler.compilePolicy({ input, safetyBounds: bounds });
  assertBoundedJson(policy, "compiledPolicy");
  assertSensitiveFree(policy, "compiledPolicy");
  const safetyValidation = compiler.validatePolicy({ policy: cloneJson(policy), input, safetyBounds: bounds });
  if (!safetyValidation || safetyValidation.valid !== true) fail("governed_policy_compilation_blocked", "Compiled policy failed safety validation.", 409, { validation: cloneJson(safetyValidation) });
  const risk = compiler.assessRisk({ policy: cloneJson(policy), validation: cloneJson(safetyValidation), input, safetyBounds: bounds });
  const riskTier = String(risk?.risk_tier ?? "high").trim().toLowerCase();
  if (!GOVERNED_POLICY_RISK_TIERS.includes(riskTier)) fail("governed_policy_risk_invalid", "Adapter returned unsupported risk tier.", 500);
  const approvalClass = canonical(risk?.required_approval_class ?? GOVERNED_POLICY_APPROVAL_CLASSES[riskTier], "risk.required_approval_class");
  const typedConfirmationRequired = risk?.typed_confirmation_required === true || riskTier === "critical";
  const impactPreview = compiler.buildImpactPreview({ policy: cloneJson(policy), validation: cloneJson(safetyValidation), risk: cloneJson(risk), input, safetyBounds: bounds });
  assertBoundedJson(impactPreview, "impactPreview");
  assertSensitiveFree(impactPreview, "impactPreview");
  const policyType = canonical(policy.policy_type ?? policy.policyType, "compiledPolicy.policy_type");
  const candidateVersion = explicitVersion(proposedVersion, "proposedVersion");
  const compilation = {
    compilation_id: randomUUID(),
    session_id: session.session_id,
    policy_type: policyType,
    proposed_version: candidateVersion,
    normalized_input_sha256: stableGovernedPolicySha256(input),
    compiled_policy: cloneJson(policy),
    compiled_policy_sha256: stableGovernedPolicySha256(policy),
    safety_validation: cloneJson(safetyValidation),
    safety_bounds_key: bounds.safety_bounds_key,
    safety_bounds_version: bounds.version,
    safety_bounds_sha256: bounds.safety_bounds_sha256,
    risk_tier: riskTier,
    required_approval_class: approvalClass,
    typed_confirmation_required: typedConfirmationRequired,
    impact_preview: cloneJson(impactPreview),
    provenance: {
      questionnaire_key: normalizedDefinition.questionnaire_key,
      questionnaire_version: normalizedDefinition.version,
      definition_sha256: normalizedDefinition.definition_sha256,
      template_key: normalizedDefinition.policy_template_key,
      template_version: normalizedDefinition.policy_template_version,
      compiler_key: normalizedDefinition.compiler_key,
      compiler_version: normalizedDefinition.compiler_version,
      impact_model_key: normalizedDefinition.impact_model_key,
      impact_model_version: normalizedDefinition.impact_model_version,
      approval_policy_key: normalizedDefinition.approval_policy_key,
      approval_policy_version: normalizedDefinition.approval_policy_version,
      normalized_answers_sha256: validated.normalized_answers_sha256,
    },
    status: "compiled",
    created_at: createdAt,
    secrets_included: false,
  };
  const completedCompilation = deepFreeze({ ...compilation, compilation_sha256: stableGovernedPolicySha256(compilation) });
  const proposalBase = {
    proposal_id: identifier(proposalId, "proposalId"),
    compilation_id: completedCompilation.compilation_id,
    tenant_id: session.tenant_id,
    policy_type: policyType,
    proposed_version: candidateVersion,
    resource_uri: resource,
    status: "submitted",
    risk_tier: riskTier,
    required_approval_class: approvalClass,
    typed_confirmation_required: typedConfirmationRequired,
    created_by: session.user_id,
    created_at: createdAt,
    updated_at: createdAt,
    secrets_included: false,
  };
  const proposalHash = stableGovernedPolicySha256({ ...proposalBase, compiled_policy_sha256: completedCompilation.compiled_policy_sha256, safety_bounds_sha256: bounds.safety_bounds_sha256 });
  return deepFreeze({ compilation: completedCompilation, proposal: { ...proposalBase, proposal_hash_sha256: proposalHash } });
}

export const governedPolicyQuestionnaireEngineContract = deepFreeze({
  version: "governed-policy-questionnaire-engine-v2",
  definition_versions_immutable: true,
  sessions_pinned_to_definition_version: true,
  context_and_prior_answer_question_selection: true,
  arbitrary_code_visibility_rules_allowed: false,
  deterministic_compilation_required: true,
  immutable_safety_bounds_required: true,
  impact_preview_required: true,
  risk_to_approval_resolution_required: true,
  proposal_resource_binding_required: true,
  exact_version_registry_readback_required_for_activation: true,
  critical_cache_invalidation_required: true,
  runtime_authority: "governed_sql_policy_registry",
  questionnaire_is_runtime_authority: false,
  no_secret_contract: true,
});

export const _testingGovernedPolicyQuestionnaireEngine = Object.freeze({
  stableNormalize,
  assertSensitiveFree,
  normalizeVisibilityRule,
  visible,
  normalizeAnswer,
  normalizeSafetyBounds,
});
