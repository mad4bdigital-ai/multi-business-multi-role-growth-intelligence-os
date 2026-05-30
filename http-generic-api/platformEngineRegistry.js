import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  buildPlatformEngineExecutionEnvelope,
  evaluatePlatformEngineCapability,
  planPolicyDrivenEngineTask,
  resolvePlatformEngineIntent,
  summarizePlatformEngineOutcomeFeedback,
} from "./platformEngineOrchestration.js";

const SENSITIVE_AUDIT_KEY_PATTERN = /(secret|password|token|api[_-]?key|authorization|credential)/i;
const MAX_AUDIT_JSON_LENGTH = 65000;

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeJsonColumns(row = {}) {
  const jsonKeys = [
    "supported_task_classes_json",
    "capabilities_json",
    "max_changes_json",
    "validators_json",
    "blocked_terms_json",
    "allowed_resource_patterns_json",
    "blocked_resource_patterns_json",
    "supported_engine_types_json",
    "supported_resource_kinds_json",
    "required_validators_json",
    "condition_json",
    "validator_commands_json",
    "allowed_terms_json",
    "required_skill_keys_json",
    "required_tools_json",
    "forbidden_tools_json",
    "success_criteria_json",
    "fallback_behavior_json",
    "metadata_json",
    "rules_matched_json",
    "skills_selected_json",
    "plan_json",
    "blocked_reasons_json",
    "error_json",
    "outcome_json",
  ];
  const normalized = { ...row };
  for (const key of jsonKeys) {
    if (key in normalized) normalized[key] = safeJsonParse(normalized[key], Array.isArray(normalized[key]) ? [] : normalized[key]);
  }
  return normalized;
}

function sanitizeAuditValue(value, depth = 0) {
  if (depth > 8) return "[max_depth]";
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_AUDIT_KEY_PATTERN.test(key)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeAuditValue(child, depth + 1);
    }
  }
  return sanitized;
}

function stringifyAuditJson(value) {
  const json = JSON.stringify(sanitizeAuditValue(value));
  if (json.length <= MAX_AUDIT_JSON_LENGTH) return json;
  return JSON.stringify({
    truncated: true,
    original_length: json.length,
    max_length: MAX_AUDIT_JSON_LENGTH,
    preview: json.slice(0, MAX_AUDIT_JSON_LENGTH),
  });
}

async function queryRows(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows.map(normalizeJsonColumns);
}

export async function listPlatformEngines({ status = "", engine_type = "", limit = 100 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (engine_type) {
    where.push("engine_type = ?");
    params.push(engine_type);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 100, 250)));
  return queryRows(
    pool,
    `SELECT * FROM platform_engine_registry
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY status = 'active' DESC, engine_type, engine_key
     LIMIT ?`,
    params
  );
}

export async function loadEngineDecisionContext({ engine_key, task_class = "" } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const engineRows = await queryRows(pool, "SELECT * FROM platform_engine_registry WHERE engine_key = ? LIMIT 1", [engine_key]);
  const engine = engineRows[0] || null;

  const policies = await queryRows(
    pool,
    `SELECT * FROM platform_engine_policy_registry
     WHERE status = 'active' AND (engine_key = ? OR engine_key IS NULL)
     ORDER BY engine_key IS NOT NULL DESC, scope_type, policy_key`,
    [engine_key]
  );
  const rules = await queryRows(
    pool,
    `SELECT * FROM platform_engine_policy_rules
     WHERE status = 'active' AND (engine_key = ? OR engine_key IS NULL) AND (task_class = ? OR task_class IS NULL OR task_class = '')
     ORDER BY priority DESC, rule_key`,
    [engine_key, task_class]
  );
  const strategies = await queryRows(pool, "SELECT * FROM platform_engine_strategy_registry WHERE status = 'active'", []);
  const skills = await queryRows(
    pool,
    `SELECT * FROM platform_engine_skill_prompt_registry
     WHERE status = 'active' AND (engine_key = ? OR engine_key IS NULL)
     ORDER BY engine_key IS NOT NULL DESC, skill_key`,
    [engine_key]
  );

  return { engine, policies, rules, strategies, skills };
}

export async function planPlatformEngineTask(input = {}, deps = {}) {
  const context = await loadEngineDecisionContext({
    engine_key: input.engine_key,
    task_class: input.task_class,
  }, deps);
  const outcomeHistory = await listPlatformEngineRuns({
    engine_key: input.engine_key,
    task_class: input.task_class,
    limit: input.outcome_history_limit || 25,
  }, deps).catch(() => []);
  const result = planPolicyDrivenEngineTask({
    ...input,
    policies: context.policies,
    rules: context.rules,
    strategies: context.strategies,
    skills: context.skills,
    outcome_history: outcomeHistory,
  });
  return {
    ...result,
    engine_registered: Boolean(context.engine),
    engine_status: context.engine?.status || null,
    registry_counts: {
      policies: context.policies.length,
      rules: context.rules.length,
      strategies: context.strategies.length,
      skills: context.skills.length,
    },
  };
}

export async function summarizePlatformEngineFeedback(input = {}, deps = {}) {
  const runs = await listPlatformEngineRuns({
    engine_key: input.engine_key,
    task_class: input.task_class,
    limit: input.limit || 50,
  }, deps);
  return summarizePlatformEngineOutcomeFeedback({
    runs,
    engine_key: input.engine_key,
    task_class: input.task_class,
  });
}

export async function createPlatformEngineExecutionEnvelope(input = {}, deps = {}) {
  const plan = await planPlatformEngineTask(input, deps);
  return buildPlatformEngineExecutionEnvelope(plan, input);
}

export function resolvePlatformEngineTaskIntent(input = {}) {
  return resolvePlatformEngineIntent(input);
}

export async function buildPlatformEngineDecisionBrief(input = {}, deps = {}) {
  const intent = resolvePlatformEngineTaskIntent(input);
  const resolvedInput = {
    ...input,
    engine_key: input.engine_key || intent.engine_key,
    task_class: input.task_class || intent.task_class,
    resource: {
      ...(input.resource || {}),
      path: input.resource_key || input.resource?.path || intent.resource?.resource_key,
      kind: input.resource_kind || input.resource?.kind || intent.resource?.resource_kind,
    },
  };
  const capability = await checkPlatformEngineCapability(resolvedInput, deps);
  const plan = await planPlatformEngineTask(resolvedInput, deps);
  const envelope = buildPlatformEngineExecutionEnvelope(plan, {
    ...resolvedInput,
    mode: resolvedInput.mode || "apply_allowed",
  });
  return {
    ok: true,
    decision_brief_type: "platform_engine_decision_brief_v1",
    decision_inputs: {
      objective_present: Boolean(input.objective || input.prompt || input.goal),
      engine_key: resolvedInput.engine_key,
      task_class: resolvedInput.task_class,
      resource_key: resolvedInput.resource?.path || "",
      resource_kind: resolvedInput.resource?.kind || "",
      requested_mode: resolvedInput.mode || "dry_run",
      scope_guard_passed: resolvedInput.scope_guard_passed === true,
      approval_granted: resolvedInput.approval_granted === true,
    },
    decision_outputs: {
      recommended_decision: plan.recommended_decision,
      can_apply: envelope.can_apply,
      risk_level: plan.risk_level,
      blockers: envelope.blockers || [],
      validators_count: Array.isArray(plan.validators) ? plan.validators.length : 0,
      feedback_adjustments: plan.feedback_summary?.adjustments || [],
    },
    intent,
    capability,
    plan,
    envelope,
    recommended_next_step: envelope.can_apply
      ? "ready_for_separate_governed_apply_route"
      : plan.recommended_decision === "dry_run"
        ? "run_or_review_dry_run_plan"
        : "resolve_capability_or_envelope_blockers",
  };
}

export async function checkPlatformEngineCapability(input = {}, deps = {}) {
  const context = await loadEngineDecisionContext({
    engine_key: input.engine_key,
    task_class: input.task_class,
  }, deps);
  return evaluatePlatformEngineCapability({
    ...input,
    engine: context.engine,
    policies: context.policies,
    rules: context.rules,
    strategies: context.strategies,
    skills: context.skills,
  });
}

export async function writePlatformEngineRun(plan = {}, input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const runId = input.run_id || randomUUID();
  const runKey = input.run_key || `engine_run:${plan.engine_key || "unknown"}:${runId}`;
  const approvalStatus = plan.approval_required
    ? input.approval_granted === true || input.approval?.granted === true ? "granted" : "required"
    : "not_required";
  const validationStatus = plan.validators?.length ? "not_run" : "blocked";
  const mode = plan.mode === "diagnose_only" ? "diagnose" : "dry_run";

  await pool.query(
    `INSERT INTO platform_engine_execution_runs (
       run_id, run_key, engine_key, task_class, mode, policy_key,
       rules_matched_json, skills_selected_json, plan_json, risk_level,
       approval_status, apply_status, validation_status, blocked_reasons_json,
       actor_id, tenant_id, trace_id, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       policy_key = VALUES(policy_key),
       rules_matched_json = VALUES(rules_matched_json),
       skills_selected_json = VALUES(skills_selected_json),
       plan_json = VALUES(plan_json),
       risk_level = VALUES(risk_level),
       approval_status = VALUES(approval_status),
       apply_status = VALUES(apply_status),
       validation_status = VALUES(validation_status),
       blocked_reasons_json = VALUES(blocked_reasons_json),
       outcome_json = VALUES(plan_json),
       completed_at = CURRENT_TIMESTAMP`,
    [
      runId,
      runKey,
      plan.engine_key || input.engine_key || "unknown",
      plan.task_class || input.task_class || "unknown",
      mode,
      plan.policy_key || null,
      stringifyAuditJson(plan.matched_rules || []),
      stringifyAuditJson((plan.skills || []).map((skill) => skill.skill_key || skill)),
      stringifyAuditJson(plan),
      plan.risk_level || "medium",
      approvalStatus,
      "not_requested",
      validationStatus,
      stringifyAuditJson(plan.blocked || []),
      input.actor_id || input.requested_by || null,
      input.tenant_id || null,
      input.trace_id || null,
    ]
  );
  return { run_id: runId, run_key: runKey };
}

export async function listPlatformEngineRuns({ engine_key = "", task_class = "", limit = 50 } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const where = [];
  const params = [];
  if (engine_key) {
    where.push("engine_key = ?");
    params.push(engine_key);
  }
  if (task_class) {
    where.push("task_class = ?");
    params.push(task_class);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 250)));
  return queryRows(
    pool,
    `SELECT * FROM platform_engine_execution_runs
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ?`,
    params
  );
}
