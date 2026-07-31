import { createHash, randomUUID } from "node:crypto";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session[_-]?token)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_JSON_BYTES = 262_144;
const MAX_QUESTION_COUNT = 200;
const MAX_ANSWER_COUNT = 200;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4_000;
const MAX_SESSION_TTL_SECONDS = 86_400;

export const GOVERNED_POLICY_INTERACTION_MODES = Object.freeze([
  "guided",
  "advanced",
  "expert_governed",
]);

export const GOVERNED_POLICY_RISK_TIERS = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

export const GOVERNED_POLICY_APPROVAL_CLASSES = Object.freeze({
  low: "tenant_owner_confirmation",
  medium: "designated_owner_approval",
  high: "platform_admin_approval",
  critical: "platform_admin_typed_confirmation",
});

export const GOVERNED_POLICY_ANSWER_TYPES = Object.freeze([
  "boolean",
  "enum",
  "integer",
  "number",
  "string",
  "multi_select",
  "object",
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

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    fail("governed_policy_invalid_key", `${field} must be a canonical key.`, 422, { field });
  }
  return normalized;
}

function opaqueId(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("governed_policy_invalid_identifier", `${field} must be a bounded opaque identifier.`, 422, { field });
  }
  return normalized;
}

function version(value, field) {
  const normalized = String(value ?? "").trim();
  if (!VERSION_RE.test(normalized)) {
    fail("governed_policy_invalid_version", `${field} must be a bounded explicit version.`, 422, { field });
  }
  return normalized;
}

function isoInstant(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    fail("governed_policy_invalid_instant", `${field} must be a valid instant.`, 422, { field });
  }
  return instant.toISOString();
}

function boundedInteger(value, field, minimum, maximum, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("governed_policy_value_out_of_bounds", `${field} is outside the supported integer bounds.`, 422, {
      field,
      minimum,
      maximum,
    });
  }
  return normalized;
}

function boundedNumber(value, field, minimum, maximum, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail("governed_policy_value_out_of_bounds", `${field} is outside the supported numeric bounds.`, 422, {
      field,
      minimum,
      maximum,
    });
  }
  return normalized;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableNormalize(value[key])]),
  );
}

export function stableGovernedPolicySha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableNormalize(value)), "utf8")
    .digest("hex");
}

function assertJsonBounded(value, field, maximumBytes = MAX_JSON_BYTES) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("governed_policy_not_json_serializable", `${field} must be JSON serializable.`, 422, { field });
  }
  const bytes = Buffer.byteLength(serialized ?? "", "utf8");
  if (bytes > maximumBytes) {
    fail("governed_policy_json_oversized", `${field} exceeds the supported byte bound.`, 413, {
      field,
      maximum_bytes: maximumBytes,
      observed_bytes: bytes,
    });
  }
}

function assertSensitiveFree(value, field = "value", depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) {
      fail("governed_policy_sensitive_value", `${field} contains a forbidden secret-like value.`, 422, { field });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      fail("governed_policy_sensitive_field", `${field}.${key} is a forbidden sensitive field.`, 422, {
        field: `${field}.${key}`,
      });
    }
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sortedUnique(values, field, normalize = canonical, maximum = MAX_ARRAY_ITEMS) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > maximum) {
    fail("governed_policy_invalid_array", `${field} must be a bounded array.`, 422, { field, maximum });
  }
  return [...new Set(values.map((item, index) => normalize(item, `${field}[${index}]`)))].sort();
}

function normalizeVisibilityRule(rule, field) {
  if (rule == null) return null;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    fail("governed_policy_invalid_visibility_rule", `${field} must be an object.`, 422, { field });
  }
  const mode = String(rule.mode ?? "all").trim().toLowerCase();
  if (!new Set(["all", "any"]).has(mode)) {
    fail("governed_policy_invalid_visibility_rule", `${field}.mode is unsupported.`, 422, { field: `${field}.mode` });
  }
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (conditions.length === 0 || conditions.length > 20) {
    fail("governed_policy_invalid_visibility_rule", `${field}.conditions must be a non-empty bounded array.`, 422, {
      field: `${field}.conditions`,
    });
  }
  const normalizedConditions = conditions.map((condition, index) => {
    const conditionField = `${field}.conditions[${index}]`;
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      fail("governed_policy_invalid_visibility_rule", `${conditionField} must be an object.`, 422, { field: conditionField });
    }
    const source = String(condition.source ?? "answer").trim().toLowerCase();
    if (!new Set(["answer", "context", "role", "mode"]).has(source)) {
      fail("governed_policy_invalid_visibility_rule", `${conditionField}.source is unsupported.`, 422, {
        field: `${conditionField}.source`,
      });
    }
    const key = source === "role" || source === "mode"
      ? String(condition.key ?? source).trim().toLowerCase()
      : canonical(condition.key, `${conditionField}.key`);
    const operator = String(condition.operator ?? "equals").trim().toLowerCase();
    if (!new Set(["equals", "not_equals", "in", "not_in", "exists", "contains"]).has(operator)) {
      fail("governed_policy_invalid_visibility_rule", `${conditionField}.operator is unsupported.`, 422, {
        field: `${conditionField}.operator`,
      });
    }
    assertSensitiveFree(condition.value, `${conditionField}.value`);
    return deepFreeze({ source, key, operator, value: cloneJson(condition.value) });
  });
  return deepFreeze({ mode, conditions: normalizedConditions });
}

function normalizeQuestion(source, index) {
  const field = `questions[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("governed_policy_invalid_question", `${field} must be an object.`, 422, { field });
  }
  const questionKey = canonical(source.question_key ?? source.questionKey, `${field}.question_key`);
  const answerType = String(source.answer_type ?? source.answerType ?? "string").trim().toLowerCase();
  if (!GOVERNED_POLICY_ANSWER_TYPES.includes(answerType)) {
    fail("governed_policy_invalid_question", `${field}.answer_type is unsupported.`, 422, {
      field: `${field}.answer_type`,
    });
  }
  const allowedValues = source.allowed_values ?? source.allowedValues ?? null;
  if (allowedValues != null && (!Array.isArray(allowedValues) || allowedValues.length > MAX_ARRAY_ITEMS)) {
    fail("governed_policy_invalid_question", `${field}.allowed_values must be a bounded array.`, 422, {
      field: `${field}.allowed_values`,
    });
  }
  assertSensitiveFree(allowedValues, `${field}.allowed_values`);
  const constraints = source.constraints == null ? {} : cloneJson(source.constraints);
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    fail("governed_policy_invalid_question", `${field}.constraints must be an object.`, 422, {
      field: `${field}.constraints`,
    });
  }
  assertSensitiveFree(constraints, `${field}.constraints`);
  const normalized = {
    question_key: questionKey,
    label: String(source.label ?? questionKey).slice(0, 512),
    description: source.description == null ? null : String(source.description).slice(0, 2_000),
    answer_type: answerType,
    allowed_values: allowedValues == null ? null : cloneJson(allowedValues),
    constraints,
    required: source.required === true,
    visibility_rule: normalizeVisibilityRule(source.visibility_rule ?? source.visibilityRule, `${field}.visibility_rule`),
    dependency_questions: sortedUnique(
      source.dependency_questions ?? source.dependencyQuestions,
      `${field}.dependency_questions`,
    ),
    risk_weight: source.risk_weight == null
      ? 0
      : boundedNumber(source.risk_weight, `${field}.risk_weight`, 0, 100),
    default_strategy_key: source.default_strategy_key == null
      ? null
      : canonical(source.default_strategy_key, `${field}.default_strategy_key`),
  };
  return deepFreeze(normalized);
}

export function normalizeQuestionnaireDefinition(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("governed_policy_invalid_definition", "definition must be an object.");
  }
  assertJsonBounded(source, "definition");
  assertSensitiveFree(source, "definition");
  const questions = Array.isArray(source.questions) ? source.questions : [];
  if (questions.length === 0 || questions.length > MAX_QUESTION_COUNT) {
    fail("governed_policy_invalid_definition", "definition.questions must be a non-empty bounded array.", 422, {
      field: "definition.questions",
      maximum: MAX_QUESTION_COUNT,
    });
  }
  const normalizedQuestions = questions.map(normalizeQuestion);
  const duplicateKeys = normalizedQuestions
    .map((question) => question.question_key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    fail("governed_policy_duplicate_question", "Question keys must be unique within a definition version.", 409, {
      question_keys: [...new Set(duplicateKeys)].sort(),
    });
  }
  const status = String(source.status ?? "active").trim().toLowerCase();
  if (!new Set(["draft", "active", "deprecated", "disabled", "expired"]).has(status)) {
    fail("governed_policy_invalid_definition", "definition.status is unsupported.", 422, { field: "definition.status" });
  }
  const interactionModes = sortedUnique(
    source.interaction_modes ?? source.interactionModes ?? ["guided"],
    "definition.interaction_modes",
    (value, field) => {
      const normalized = String(value ?? "").trim().toLowerCase();
      if (!GOVERNED_POLICY_INTERACTION_MODES.includes(normalized)) {
        fail("governed_policy_invalid_definition", `${field} is unsupported.`, 422, { field });
      }
      return normalized;
    },
  );
  const definition = {
    questionnaire_key: canonical(source.questionnaire_key ?? source.questionnaireKey, "definition.questionnaire_key"),
    version: version(source.version, "definition.version"),
    domain_key: canonical(source.domain_key ?? source.domainKey, "definition.domain_key"),
    purpose_key: canonical(source.purpose_key ?? source.purposeKey, "definition.purpose_key"),
    applicable_actor_roles: sortedUnique(
      source.applicable_actor_roles ?? source.applicableActorRoles,
      "definition.applicable_actor_roles",
    ),
    interaction_modes: interactionModes,
    context_rule_key: source.context_rule_key == null
      ? null
      : canonical(source.context_rule_key, "definition.context_rule_key"),
    policy_template_key: canonical(source.policy_template_key ?? source.policyTemplateKey, "definition.policy_template_key"),
    policy_template_version: version(
      source.policy_template_version ?? source.policyTemplateVersion,
      "definition.policy_template_version",
    ),
    compiler_key: canonical(source.compiler_key ?? source.compilerKey, "definition.compiler_key"),
    compiler_version: version(source.compiler_version ?? source.compilerVersion, "definition.compiler_version"),
    impact_model_key: canonical(source.impact_model_key ?? source.impactModelKey, "definition.impact_model_key"),
    impact_model_version: version(
      source.impact_model_version ?? source.impactModelVersion,
      "definition.impact_model_version",
    ),
    approval_policy_key: canonical(source.approval_policy_key ?? source.approvalPolicyKey, "definition.approval_policy_key"),
    approval_policy_version: version(
      source.approval_policy_version ?? source.approvalPolicyVersion,
      "definition.approval_policy_version",
    ),
    status,
    effective_at: isoInstant(source.effective_at ?? source.effectiveAt, "definition.effective_at"),
    expires_at: isoInstant(source.expires_at ?? source.expiresAt, "definition.expires_at", { nullable: true }),
    questions: normalizedQuestions,
    secrets_included: false,
  };
  return deepFreeze({
    ...definition,
    definition_sha256: stableGovernedPolicySha256(definition),
  });
}

function readConditionSource(condition, { answers, context, actorRoles, interactionMode }) {
  if (condition.source === "answer") return answers[condition.key];
  if (condition.source === "context") return context[condition.key];
  if (condition.source === "role") return actorRoles;
  if (condition.source === "mode") return interactionMode;
  return undefined;
}

function conditionMatches(condition, state) {
  const observed = readConditionSource(condition, state);
  switch (condition.operator) {
    case "exists":
      return condition.value === false ? observed == null : observed != null;
    case "equals":
      return stableGovernedPolicySha256(observed) === stableGovernedPolicySha256(condition.value);
    case "not_equals":
      return stableGovernedPolicySha256(observed) !== stableGovernedPolicySha256(condition.value);
    case "in":
      return Array.isArray(condition.value)
        && condition.value.some((candidate) => stableGovernedPolicySha256(candidate) === stableGovernedPolicySha256(observed));
    case "not_in":
      return Array.isArray(condition.value)
        && !condition.value.some((candidate) => stableGovernedPolicySha256(candidate) === stableGovernedPolicySha256(observed));
    case "contains":
      return Array.isArray(observed)
        && observed.some((candidate) => stableGovernedPolicySha256(candidate) === stableGovernedPolicySha256(condition.value));
    default:
      return false;
  }
}

function questionVisible(question, state) {
  if (!question.visibility_rule) return true;
  const results = question.visibility_rule.conditions.map((condition) => conditionMatches(condition, state));
  return question.visibility_rule.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

export function selectGovernedPolicyQuestions({ definition, answers = {}, context = {}, actorRoles = [], interactionMode }) {
  const normalizedDefinition = definition?.definition_sha256
    ? definition
    : normalizeQuestionnaireDefinition(definition);
  const normalizedMode = String(interactionMode ?? normalizedDefinition.interaction_modes[0]).trim().toLowerCase();
  if (!normalizedDefinition.interaction_modes.includes(normalizedMode)) {
    fail("governed_policy_interaction_mode_not_allowed", "The requested interaction mode is not allowed by this definition.", 403, {
      interaction_mode: normalizedMode,
    });
  }
  const normalizedRoles = sortedUnique(actorRoles, "actorRoles");
  const eligible = normalizedDefinition.applicable_actor_roles.length === 0
    || normalizedRoles.some((role) => normalizedDefinition.applicable_actor_roles.includes(role));
  if (!eligible) {
    fail("governed_policy_actor_not_eligible", "The actor is not eligible for this questionnaire definition.", 403);
  }
  assertJsonBounded(answers, "answers");
  assertJsonBounded(context, "context");
  assertSensitiveFree(answers, "answers");
  assertSensitiveFree(context, "context");
  const state = { answers, context, actorRoles: normalizedRoles, interactionMode: normalizedMode };
  return deepFreeze(
    normalizedDefinition.questions
      .filter((question) => questionVisible(question, state))
      .map((question) => ({ ...question })),
  );
}

export function createPinnedQuestionnaireSession({
  definition,
  tenantId,
  userId,
  actorRoles = [],
  interactionMode,
  context = {},
  now = new Date(),
  ttlSeconds = 3_600,
  sessionId = randomUUID(),
} = {}) {
  const normalizedDefinition = definition?.definition_sha256
    ? definition
    : normalizeQuestionnaireDefinition(definition);
  if (normalizedDefinition.status !== "active") {
    fail("governed_policy_definition_not_active", "Only an active questionnaire definition can start a session.", 409, {
      status: normalizedDefinition.status,
    });
  }
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) {
    fail("governed_policy_invalid_instant", "now must be a valid instant.");
  }
  const effectiveAt = new Date(normalizedDefinition.effective_at);
  const expiresAt = normalizedDefinition.expires_at ? new Date(normalizedDefinition.expires_at) : null;
  if (effectiveAt.getTime() > instant.getTime() || (expiresAt && expiresAt.getTime() <= instant.getTime())) {
    fail("governed_policy_definition_not_effective", "The questionnaire definition is not effective at the requested time.", 409);
  }
  const boundedTtl = boundedInteger(ttlSeconds, "ttlSeconds", 60, MAX_SESSION_TTL_SECONDS);
  const normalizedMode = String(interactionMode ?? normalizedDefinition.interaction_modes[0]).trim().toLowerCase();
  const normalizedRoles = sortedUnique(actorRoles, "actorRoles");
  selectGovernedPolicyQuestions({
    definition: normalizedDefinition,
    answers: {},
    context,
    actorRoles: normalizedRoles,
    interactionMode: normalizedMode,
  });
  assertJsonBounded(context, "context");
  assertSensitiveFree(context, "context");
  const session = {
    session_id: opaqueId(sessionId, "sessionId"),
    tenant_id: opaqueId(tenantId, "tenantId"),
    user_id: opaqueId(userId, "userId"),
    questionnaire_key: normalizedDefinition.questionnaire_key,
    questionnaire_version: normalizedDefinition.version,
    definition_sha256: normalizedDefinition.definition_sha256,
    domain_key: normalizedDefinition.domain_key,
    purpose_key: normalizedDefinition.purpose_key,
    interaction_mode: normalizedMode,
    actor_roles: normalizedRoles,
    context_snapshot: cloneJson(context),
    status: "open",
    revision: 1,
    created_at: instant.toISOString(),
    expires_at: new Date(instant.getTime() + boundedTtl * 1_000).toISOString(),
    secrets_included: false,
  };
  return deepFreeze({
    ...session,
    session_binding_sha256: stableGovernedPolicySha256(session),
  });
}

function normalizeAnswerValue(question, value, field) {
  const constraints = question.constraints ?? {};
  switch (question.answer_type) {
    case "boolean":
      if (typeof value !== "boolean") fail("governed_policy_answer_invalid", `${field} must be boolean.`, 422, { field });
      return value;
    case "integer": {
      const minimum = Number.isFinite(Number(constraints.minimum)) ? Number(constraints.minimum) : -1_000_000_000;
      const maximum = Number.isFinite(Number(constraints.maximum)) ? Number(constraints.maximum) : 1_000_000_000;
      return boundedInteger(value, field, minimum, maximum);
    }
    case "number": {
      const minimum = Number.isFinite(Number(constraints.minimum)) ? Number(constraints.minimum) : -1_000_000_000;
      const maximum = Number.isFinite(Number(constraints.maximum)) ? Number(constraints.maximum) : 1_000_000_000;
      return boundedNumber(value, field, minimum, maximum);
    }
    case "enum": {
      if (!Array.isArray(question.allowed_values) || question.allowed_values.length === 0) {
        fail("governed_policy_definition_invalid", `${question.question_key} requires allowed_values.`, 500);
      }
      const match = question.allowed_values.find(
        (candidate) => stableGovernedPolicySha256(candidate) === stableGovernedPolicySha256(value),
      );
      if (match === undefined) {
        fail("governed_policy_answer_invalid", `${field} is not an allowed value.`, 422, { field });
      }
      return cloneJson(match);
    }
    case "multi_select": {
      if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) {
        fail("governed_policy_answer_invalid", `${field} must be a bounded array.`, 422, { field });
      }
      const unique = [];
      for (const candidate of value) {
        const match = Array.isArray(question.allowed_values)
          ? question.allowed_values.find(
            (allowed) => stableGovernedPolicySha256(allowed) === stableGovernedPolicySha256(candidate),
          )
          : candidate;
        if (match === undefined) {
          fail("governed_policy_answer_invalid", `${field} contains an unsupported value.`, 422, { field });
        }
        if (!unique.some((existing) => stableGovernedPolicySha256(existing) === stableGovernedPolicySha256(match))) {
          unique.push(cloneJson(match));
        }
      }
      const minimumItems = Number.isSafeInteger(Number(constraints.minimum_items)) ? Number(constraints.minimum_items) : 0;
      const maximumItems = Number.isSafeInteger(Number(constraints.maximum_items))
        ? Number(constraints.maximum_items)
        : MAX_ARRAY_ITEMS;
      if (unique.length < minimumItems || unique.length > maximumItems) {
        fail("governed_policy_answer_invalid", `${field} has invalid cardinality.`, 422, {
          field,
          minimum_items: minimumItems,
          maximum_items: maximumItems,
        });
      }
      return unique.sort((left, right) => JSON.stringify(stableNormalize(left)).localeCompare(JSON.stringify(stableNormalize(right))));
    }
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("governed_policy_answer_invalid", `${field} must be an object.`, 422, { field });
      }
      assertJsonBounded(value, field, Number(constraints.maximum_bytes) || 32_768);
      return cloneJson(value);
    case "string":
    default: {
      if (typeof value !== "string") fail("governed_policy_answer_invalid", `${field} must be a string.`, 422, { field });
      const minimumLength = Number.isSafeInteger(Number(constraints.minimum_length)) ? Number(constraints.minimum_length) : 0;
      const maximumLength = Number.isSafeInteger(Number(constraints.maximum_length))
        ? Math.min(Number(constraints.maximum_length), MAX_STRING_LENGTH)
        : MAX_STRING_LENGTH;
      const normalized = constraints.trim === false ? value : value.trim();
      if (normalized.length < minimumLength || normalized.length > maximumLength) {
        fail("governed_policy_answer_invalid", `${field} has invalid length.`, 422, {
          field,
          minimum_length: minimumLength,
          maximum_length: maximumLength,
        });
      }
      if (constraints.pattern) {
        let pattern;
        try {
          pattern = new RegExp(String(constraints.pattern));
        } catch {
          fail("governed_policy_definition_invalid", `${question.question_key} contains an invalid pattern.`, 500);
        }
        if (!pattern.test(normalized)) {
          fail("governed_policy_answer_invalid", `${field} does not match the required pattern.`, 422, { field });
        }
      }
      return normalized;
    }
  }
}

export function validateQuestionnaireAnswers({ session, definition, answers = {} } = {}) {
  const normalizedDefinition = definition?.definition_sha256
    ? definition
    : normalizeQuestionnaireDefinition(definition);
  if (!session || typeof session !== "object") {
    fail("governed_policy_session_required", "session is required.", 400);
  }
  if (
    session.questionnaire_key !== normalizedDefinition.questionnaire_key
    || session.questionnaire_version !== normalizedDefinition.version
    || session.definition_sha256 !== normalizedDefinition.definition_sha256
  ) {
    fail("governed_policy_session_definition_drift", "The session is not pinned to the supplied definition version.", 409);
  }
  const now = new Date();
  if (new Date(session.expires_at).getTime() <= now.getTime()) {
    fail("governed_policy_session_expired", "The questionnaire session has expired.", 409);
  }
  if (!new Set(["open", "ready_for_preview"]).has(session.status)) {
    fail("governed_policy_session_not_editable", "The questionnaire session is not editable.", 409, {
      status: session.status,
    });
  }
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    fail("governed_policy_answers_invalid", "answers must be an object.", 422);
  }
  const entries = Object.entries(answers);
  if (entries.length > MAX_ANSWER_COUNT) {
    fail("governed_policy_answers_oversized", "answers contains too many entries.", 413, {
      maximum: MAX_ANSWER_COUNT,
    });
  }
  assertJsonBounded(answers, "answers");
  assertSensitiveFree(answers, "answers");
  const visibleQuestions = selectGovernedPolicyQuestions({
    definition: normalizedDefinition,
    answers,
    context: session.context_snapshot,
    actorRoles: session.actor_roles,
    interactionMode: session.interaction_mode,
  });
  const visibleByKey = new Map(visibleQuestions.map((question) => [question.question_key, question]));
  const unknown = entries.map(([key]) => key).filter((key) => !visibleByKey.has(key));
  if (unknown.length > 0) {
    fail("governed_policy_answer_not_visible", "Answers may only target questions visible in the pinned session context.", 422, {
      question_keys: unknown.sort(),
    });
  }
  const missing = visibleQuestions
    .filter((question) => question.required && !Object.hasOwn(answers, question.question_key))
    .map((question) => question.question_key);
  if (missing.length > 0) {
    fail("governed_policy_required_answers_missing", "Required visible questions are unanswered.", 422, {
      question_keys: missing.sort(),
    });
  }
  const normalizedAnswers = Object.fromEntries(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeAnswerValue(visibleByKey.get(key), value, `answers.${key}`)]),
  );
  const answerEvidence = {
    session_id: session.session_id,
    session_binding_sha256: session.session_binding_sha256,
    questionnaire_key: normalizedDefinition.questionnaire_key,
    questionnaire_version: normalizedDefinition.version,
    definition_sha256: normalizedDefinition.definition_sha256,
    answers: normalizedAnswers,
    visible_question_keys: visibleQuestions.map((question) => question.question_key).sort(),
    secrets_included: false,
  };
  return deepFreeze({
    ...answerEvidence,
    normalized_answers_sha256: stableGovernedPolicySha256(answerEvidence),
  });
}

function normalizeSafetyBounds(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("governed_policy_safety_bounds_required", "safetyBounds must be an object.", 400);
  }
  assertJsonBounded(source, "safetyBounds");
  assertSensitiveFree(source, "safetyBounds");
  const normalized = {
    safety_bounds_key: canonical(source.safety_bounds_key ?? source.safetyBoundsKey, "safetyBounds.safety_bounds_key"),
    version: version(source.version, "safetyBounds.version"),
    domain_key: canonical(source.domain_key ?? source.domainKey, "safetyBounds.domain_key"),
    immutable_rules: sortedUnique(
      source.immutable_rules ?? source.immutableRules,
      "safetyBounds.immutable_rules",
    ),
    configurable_fields: cloneJson(source.configurable_fields ?? source.configurableFields ?? {}),
    risk_matrix: cloneJson(source.risk_matrix ?? source.riskMatrix ?? {}),
    status: String(source.status ?? "active").trim().toLowerCase(),
  };
  if (normalized.status !== "active") {
    fail("governed_policy_safety_bounds_not_active", "Safety bounds must be active.", 409);
  }
  return deepFreeze({
    ...normalized,
    safety_bounds_sha256: stableGovernedPolicySha256(normalized),
  });
}

function validateAdapter(adapter, definition) {
  if (!adapter || typeof adapter !== "object") {
    fail("governed_policy_domain_adapter_required", "A governed domain adapter is required.", 400);
  }
  const key = canonical(adapter.key, "adapter.key");
  const adapterVersion = version(adapter.version, "adapter.version");
  if (key !== definition.compiler_key || adapterVersion !== definition.compiler_version) {
    fail("governed_policy_compiler_version_mismatch", "The domain adapter does not match the pinned compiler key/version.", 409, {
      expected_key: definition.compiler_key,
      expected_version: definition.compiler_version,
      observed_key: key,
      observed_version: adapterVersion,
    });
  }
  for (const method of ["compilePolicy", "validatePolicy", "assessRisk", "buildImpactPreview"]) {
    if (typeof adapter[method] !== "function") {
      fail("governed_policy_domain_adapter_invalid", `adapter.${method} is required.`, 500, { method });
    }
  }
  return adapter;
}

export function compileGovernedPolicyProposal({
  session,
  definition,
  answers,
  safetyBounds,
  adapter,
  resourceUri,
  proposedVersion,
  now = new Date(),
  proposalId = randomUUID(),
} = {}) {
  const normalizedDefinition = definition?.definition_sha256
    ? definition
    : normalizeQuestionnaireDefinition(definition);
  const validatedAnswers = validateQuestionnaireAnswers({ session, definition: normalizedDefinition, answers });
  const normalizedBounds = normalizeSafetyBounds(safetyBounds);
  if (normalizedBounds.domain_key !== normalizedDefinition.domain_key) {
    fail("governed_policy_safety_bounds_domain_mismatch", "Safety bounds do not match the questionnaire domain.", 409);
  }
  const domainAdapter = validateAdapter(adapter, normalizedDefinition);
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) fail("governed_policy_invalid_instant", "now must be a valid instant.");
  const compileInput = deepFreeze({
    questionnaire: {
      key: normalizedDefinition.questionnaire_key,
      version: normalizedDefinition.version,
      definition_sha256: normalizedDefinition.definition_sha256,
    },
    template: {
      key: normalizedDefinition.policy_template_key,
      version: normalizedDefinition.policy_template_version,
    },
    compiler: {
      key: normalizedDefinition.compiler_key,
      version: normalizedDefinition.compiler_version,
    },
    impact_model: {
      key: normalizedDefinition.impact_model_key,
      version: normalizedDefinition.impact_model_version,
    },
    approval_policy: {
      key: normalizedDefinition.approval_policy_key,
      version: normalizedDefinition.approval_policy_version,
    },
    safety_bounds: {
      key: normalizedBounds.safety_bounds_key,
      version: normalizedBounds.version,
      sha256: normalizedBounds.safety_bounds_sha256,
    },
    session: {
      id: session.session_id,
      binding_sha256: session.session_binding_sha256,
      tenant_id: session.tenant_id,
      user_id: session.user_id,
      context_snapshot: cloneJson(session.context_snapshot),
      interaction_mode: session.interaction_mode,
      actor_roles: [...session.actor_roles],
    },
    normalized_answers: cloneJson(validatedAnswers.answers),
    normalized_answers_sha256: validatedAnswers.normalized_answers_sha256,
  });
  const compiledPolicy = domainAdapter.compilePolicy({
    input: compileInput,
    safetyBounds: normalizedBounds,
  });
  assertJsonBounded(compiledPolicy, "compiledPolicy");
  assertSensitiveFree(compiledPolicy, "compiledPolicy");
  const safetyValidation = domainAdapter.validatePolicy({
    policy: cloneJson(compiledPolicy),
    input: compileInput,
    safetyBounds: normalizedBounds,
  });
  assertJsonBounded(safetyValidation, "safetyValidation");
  assertSensitiveFree(safetyValidation, "safetyValidation");
  if (!safetyValidation || typeof safetyValidation !== "object" || safetyValidation.valid !== true) {
    fail("governed_policy_compilation_blocked", "The compiled policy failed immutable safety validation.", 409, {
      validation: cloneJson(safetyValidation),
    });
  }
  const risk = domainAdapter.assessRisk({
    policy: cloneJson(compiledPolicy),
    validation: cloneJson(safetyValidation),
    input: compileInput,
    safetyBounds: normalizedBounds,
  });
  const riskTier = String(risk?.risk_tier ?? risk?.riskTier ?? "high").trim().toLowerCase();
  if (!GOVERNED_POLICY_RISK_TIERS.includes(riskTier)) {
    fail("governed_policy_risk_invalid", "The domain adapter returned an unsupported risk tier.", 500);
  }
  const requiredApprovalClass = canonical(
    risk?.required_approval_class
      ?? risk?.requiredApprovalClass
      ?? GOVERNED_POLICY_APPROVAL_CLASSES[riskTier],
    "risk.required_approval_class",
  );
  const typedConfirmationRequired = risk?.typed_confirmation_required === true
    || risk?.typedConfirmationRequired === true
    || riskTier === "critical";
  const impactPreview = domainAdapter.buildImpactPreview({
    policy: cloneJson(compiledPolicy),
    validation: cloneJson(safetyValidation),
    risk: cloneJson(risk),
    input: compileInput,
    safetyBounds: normalizedBounds,
  });
  assertJsonBounded(impactPreview, "impactPreview");
  assertSensitiveFree(impactPreview, "impactPreview");
  const normalizedResourceUri = String(resourceUri ?? "").trim();
  if (!normalizedResourceUri || normalizedResourceUri.length > 2_048) {
    fail("governed_policy_resource_invalid", "resourceUri is required and must be bounded.", 422);
  }
  let parsedResource;
  try {
    parsedResource = new URL(normalizedResourceUri);
  } catch {
    fail("governed_policy_resource_invalid", "resourceUri must be an absolute URI.", 422);
  }
  if (!new Set(["https:", "urn:"]).has(parsedResource.protocol)) {
    fail("governed_policy_resource_invalid", "resourceUri must use https or urn authority.", 422);
  }
  const policyType = canonical(compiledPolicy.policy_type ?? compiledPolicy.policyType, "compiledPolicy.policy_type");
  const candidateVersion = version(proposedVersion, "proposedVersion");
  const compilation = {
    compilation_id: randomUUID(),
    session_id: session.session_id,
    policy_type: policyType,
    proposed_version: candidateVersion,
    normalized_input_sha256: stableGovernedPolicySha256(compileInput),
    compiled_policy: cloneJson(compiledPolicy),
    compiled_policy_sha256: stableGovernedPolicySha256(compiledPolicy),
    safety_validation: cloneJson(safetyValidation),
    safety_bounds_key: normalizedBounds.safety_bounds_key,
    safety_bounds_version: normalizedBounds.version,
    safety_bounds_sha256: normalizedBounds.safety_bounds_sha256,
    risk_tier: riskTier,
    required_approval_class: requiredApprovalClass,
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
      normalized_answers_sha256: validatedAnswers.normalized_answers_sha256,
    },
    status: "compiled",
    created_at: instant.toISOString(),
    secrets_included: false,
  };
  const proposal = {
    proposal_id: opaqueId(proposalId, "proposalId"),
    compilation_id: compilation.compilation_id,
    tenant_id: session.tenant_id,
    policy_type: policyType,
    proposed_version: candidateVersion,
    resource_uri: normalizedResourceUri,
    status: "submitted",
    risk_tier: riskTier,
    required_approval_class: requiredApprovalClass,
    typed_confirmation_required: typedConfirmationRequired,
    proposal_hash_sha256: stableGovernedPolicySha256({
      tenant_id: session.tenant_id,
      policy_type: policyType,
      proposed_version: candidateVersion,
      resource_uri: normalizedResourceUri,
      compiled_policy_sha256: compilation.compiled_policy_sha256,
      safety_bounds_sha256: normalizedBounds.safety_bounds_sha256,
      required_approval_class: requiredApprovalClass,
      typed_confirmation_required: typedConfirmationRequired,
    }),
    created_by: session.user_id,
    created_at: instant.toISOString(),
    updated_at: instant.toISOString(),
    secrets_included: false,
  };
  return deepFreeze({
    compilation: {
      ...compilation,
      compilation_sha256: stableGovernedPolicySha256(compilation),
    },
    proposal,
  });
}

export const governedPolicyQuestionnaireEngineContract = deepFreeze({
  version: "governed-policy-questionnaire-engine-v1",
  definition_versions_immutable: true,
  sessions_pinned_to_definition_version: true,
  context_aware_question_selection: true,
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
  questionVisible,
  normalizeAnswerValue,
  normalizeSafetyBounds,
});
