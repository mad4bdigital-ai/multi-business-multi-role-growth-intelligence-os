const RISK_ORDER = ["low", "medium", "high", "critical"];
const SAFE_FALLBACK_MODE = "diagnose_only";

function compactString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeRisk(value, fallback = "medium") {
  const risk = compactString(value || fallback).toLowerCase();
  return RISK_ORDER.includes(risk) ? risk : fallback;
}

function riskAtLeast(actual, threshold) {
  return RISK_ORDER.indexOf(normalizeRisk(actual)) >= RISK_ORDER.indexOf(normalizeRisk(threshold));
}

function normalizeMode(value, fallback = SAFE_FALLBACK_MODE) {
  const mode = compactString(value || fallback).toLowerCase();
  return ["diagnose_only", "dry_run", "apply_allowed"].includes(mode) ? mode : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern) {
  const source = compactString(pattern);
  if (!source || source === "*") return /^.*$/;
  const parts = source.split(/(\*\*)|(\*)/g).filter((part) => part !== undefined && part !== "");
  const regex = parts.map((part) => {
    if (part === "**") return ".*";
    if (part === "*") return "[^/\\\\]*";
    return escapeRegex(part);
  }).join("");
  return new RegExp(`^${regex}$`, "i");
}

function matchesPattern(pattern, value) {
  const normalizedPattern = compactString(pattern);
  if (!normalizedPattern || normalizedPattern === "*") return true;
  return globToRegex(normalizedPattern).test(compactString(value).replace(/\\/g, "/"));
}

export function classifyPlatformEngineResource(resource = {}) {
  const key = compactString(resource.path || resource.key || resource.id || resource.resource_key || "*").replace(/\\/g, "/");
  const explicitKind = compactString(resource.kind || resource.resource_kind);
  if (explicitKind && explicitKind !== "generic") return { resource_key: key, resource_kind: explicitKind, conflict_type: compactString(resource.conflict_type || "generic") };

  if (/package\.json$/i.test(key)) return { resource_key: key, resource_kind: "json", conflict_type: "package_json_script_conflict" };
  if (/memory_schema\.json$/i.test(key) || /schemas\/.*\.schema\.json$/i.test(key)) return { resource_key: key, resource_kind: "json_schema", conflict_type: "schema_contract_conflict" };
  if (/http-generic-api\/auth.*\.js$/i.test(key)) return { resource_key: key, resource_kind: "javascript", conflict_type: "auth_surface_conflict" };
  if (/http-generic-api\/migrations\/.*\.sql$/i.test(key)) return { resource_key: key, resource_kind: "sql", conflict_type: "migration_conflict" };
  if (/\.md$/i.test(key)) return { resource_key: key, resource_kind: "markdown", conflict_type: "documentation_conflict" };
  if (/\.ya?ml$/i.test(key)) return { resource_key: key, resource_kind: "yaml", conflict_type: "yaml_contract_conflict" };
  if (/\.json$/i.test(key)) return { resource_key: key, resource_kind: "json", conflict_type: "json_conflict" };
  if (/\.(mjs|js|cjs)$/i.test(key)) return { resource_key: key, resource_kind: "javascript", conflict_type: "javascript_conflict" };
  return { resource_key: key, resource_kind: "generic", conflict_type: compactString(resource.conflict_type || "generic") };
}

export function resolvePlatformEngineIntent(input = {}) {
  const objective = compactString(input.objective || input.prompt || input.goal).toLowerCase();
  const classified = classifyPlatformEngineResource({
    ...(input.resource || {}),
    resource_key: input.resource_key,
    resource_kind: input.resource_kind,
  });
  const explicitEngine = compactString(input.engine_key);
  const explicitTask = compactString(input.task_class);
  const reasons = [];

  let engineKey = explicitEngine;
  let taskClass = explicitTask;
  let skillKey = "";
  let confidence = "medium";

  if (explicitEngine) reasons.push("explicit_engine_key");
  if (explicitTask) reasons.push("explicit_task_class");

  if (!engineKey || !taskClass) {
    if (/(database table|table lifecycle|db census|information_schema|retention|archive candidate|unused table|unlinked table|data_migration_inventory)/i.test(objective)) {
      engineKey = engineKey || "database_table_lifecycle_engine";
      taskClass = taskClass || "table_lifecycle_decision_brief";
      skillKey = "database_table_lifecycle";
      confidence = "high";
      reasons.push("database_lifecycle_language");
    } else if (/(schema|memory_schema|legacy sheet|sql authority|contract cleanup)/i.test(objective) || classified.resource_kind === "json_schema") {
      engineKey = engineKey || "schema_cleanup_engine";
      taskClass = taskClass || "schema_plan";
      skillKey = "schema_cleanup";
      confidence = "high";
      reasons.push("schema_governance_language_or_resource_shape");
    } else if (/(conflict|merge|rebase|resolve branch|<<<<<<<|>>>>>>>)/i.test(objective) || /_conflict$/.test(classified.conflict_type)) {
      engineKey = engineKey || "repo_conflict_resolution_engine";
      taskClass = taskClass || "conflict_plan";
      skillKey = "repo_conflict_resolution";
      confidence = "high";
      reasons.push("conflict_language_or_resource_shape");
    } else if (/(provider smoke|smoke cert|certify plugin|recertify|plugin smoke)/i.test(objective)) {
      engineKey = engineKey || "provider_smoke_certification_engine";
      taskClass = taskClass || "certify_plugin";
      skillKey = "provider_smoke_certification";
      confidence = "high";
      reasons.push("provider_smoke_language");
    } else if (/(release readiness|release gate|ship check|deployment readiness)/i.test(objective)) {
      engineKey = engineKey || "release_readiness_engine";
      taskClass = taskClass || "release_check";
      skillKey = "release_readiness";
      confidence = "medium";
      reasons.push("release_readiness_language");
    } else if (/(activation|hard activation|bootstrap validation|activate system)/i.test(objective)) {
      engineKey = engineKey || "activation_validation_engine";
      taskClass = taskClass || "activation_validate";
      skillKey = "activation_validation";
      confidence = "medium";
      reasons.push("activation_validation_language");
    }
  }

  if (!engineKey) {
    engineKey = "generic_policy_engine";
    taskClass = taskClass || "diagnose";
    confidence = "low";
    reasons.push("safe_generic_fallback");
  }

  return {
    ok: true,
    engine_key: engineKey,
    task_class: taskClass || "diagnose",
    skill_key: skillKey || null,
    confidence,
    resource: classified,
    rationale: reasons,
    next_step: "run_capability_check_then_task_plan",
  };
}

function normalizeRegistryRow(row = {}) {
  return {
    ...row,
    engine_key: compactString(row.engine_key),
    task_class: compactString(row.task_class),
    resource_pattern: compactString(row.resource_pattern || row.path_glob || row.scope_pattern || "*"),
    strategy_key: compactString(row.strategy_key),
    risk_level: normalizeRisk(row.risk_level),
    condition_json: normalizeJsonObject(row.condition_json),
    validator_commands_json: normalizeJsonList(row.validator_commands_json),
    blocked_terms_json: normalizeJsonList(row.blocked_terms_json),
    allowed_terms_json: normalizeJsonList(row.allowed_terms_json),
    required_skill_keys_json: normalizeJsonList(row.required_skill_keys_json),
    auto_apply_allowed: row.auto_apply_allowed === true || row.auto_apply_allowed === 1,
    approval_required: row.approval_required === true || row.approval_required === 1,
    deny: row.deny === true || row.deny === 1 || compactString(row.strategy_key) === "manual_only",
    status: compactString(row.status || "active").toLowerCase(),
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 0,
  };
}

function normalizeStrategy(row = {}) {
  const metadata = normalizeJsonObject(row.metadata_json || row.metadata);
  return {
    ...row,
    strategy_key: compactString(row.strategy_key),
    supported_engine_types_json: normalizeJsonList(row.supported_engine_types_json),
    supported_task_classes_json: normalizeJsonList(row.supported_task_classes_json),
    supported_resource_kinds_json: normalizeJsonList(row.supported_resource_kinds_json),
    required_validators_json: normalizeJsonList(row.required_validators_json),
    allows_full_resource_rewrite: row.allows_full_resource_rewrite === true || row.allows_full_resource_rewrite === 1,
    executes_dynamic_code: row.executes_dynamic_code === true || row.executes_dynamic_code === 1 || Boolean(metadata.inline_code || metadata.implementation_code),
    risk_level: normalizeRisk(row.risk_level),
    status: compactString(row.status || "active").toLowerCase(),
  };
}

function normalizePolicy(row = {}) {
  return {
    ...row,
    policy_key: compactString(row.policy_key),
    engine_key: compactString(row.engine_key),
    mode: normalizeMode(row.mode),
    risk_default: normalizeRisk(row.risk_default || "medium"),
    approval_required_min_risk: normalizeRisk(row.approval_required_min_risk || "high"),
    require_scope_guard: row.require_scope_guard !== false && row.require_scope_guard !== 0,
    require_audit: row.require_audit !== false && row.require_audit !== 0,
    require_validators: row.require_validators === true || row.require_validators === 1,
    validators_json: normalizeJsonList(row.validators_json),
    blocked_resource_patterns_json: normalizeJsonList(row.blocked_resource_patterns_json),
    allowed_resource_patterns_json: normalizeJsonList(row.allowed_resource_patterns_json),
    status: compactString(row.status || "active").toLowerCase(),
  };
}

function normalizeSkill(row = {}) {
  return {
    ...row,
    skill_key: compactString(row.skill_key || row.name),
    engine_key: compactString(row.engine_key),
    task_classes_json: normalizeJsonList(row.task_classes_json),
    required_tools_json: normalizeJsonList(row.required_tools_json || row.tools),
    forbidden_tools_json: normalizeJsonList(row.forbidden_tools_json),
    validator_commands_json: normalizeJsonList(row.validator_commands_json),
    success_criteria_json: normalizeJsonList(row.success_criteria_json),
    status: compactString(row.status || "active").toLowerCase(),
  };
}

function ruleMatchesTask(rule, task) {
  if (rule.status !== "active") return false;
  if (rule.engine_key && rule.engine_key !== task.engine_key) return false;
  if (rule.task_class && rule.task_class !== task.task_class) return false;
  return matchesPattern(rule.resource_pattern, task.resource_key);
}

function choosePolicy(task, policies) {
  const active = policies.map(normalizePolicy).filter((policy) => policy.status === "active");
  return active.find((policy) => policy.engine_key === task.engine_key && policy.scope_id === task.scope_id) ||
    active.find((policy) => policy.engine_key === task.engine_key && !policy.scope_id) ||
    active.find((policy) => policy.policy_key === "platform_engine_default_v1") ||
    normalizePolicy({ policy_key: "safe_fallback", mode: SAFE_FALLBACK_MODE, require_scope_guard: true });
}

function chooseSkills(task, rules, skills) {
  const requiredKeys = new Set(rules.flatMap((rule) => rule.required_skill_keys_json));
  return skills
    .map(normalizeSkill)
    .filter((skill) => skill.status === "active")
    .filter((skill) => {
      if (requiredKeys.size > 0) return requiredKeys.has(skill.skill_key);
      if (skill.engine_key && skill.engine_key !== task.engine_key) return false;
      const taskClasses = skill.task_classes_json;
      return taskClasses.length === 0 || taskClasses.includes(task.task_class);
    });
}

function strategyAvailable(strategy, task) {
  if (!strategy || strategy.status !== "active") return false;
  if (strategy.executes_dynamic_code) return false;
  if (strategy.supported_task_classes_json.length && !strategy.supported_task_classes_json.includes(task.task_class)) return false;
  if (strategy.supported_resource_kinds_json.length && !strategy.supported_resource_kinds_json.includes(task.resource_kind)) return false;
  return true;
}

function classifyResource(task, policy) {
  const blocks = [];
  const allowed = policy.allowed_resource_patterns_json;
  const denied = policy.blocked_resource_patterns_json;

  if (allowed.length > 0 && !allowed.some((pattern) => matchesPattern(pattern, task.resource_key))) {
    blocks.push("resource_outside_allowed_patterns");
  }

  if (denied.some((pattern) => matchesPattern(pattern, task.resource_key))) {
    blocks.push("resource_matches_blocked_pattern");
  }

  return blocks;
}

export function summarizePlatformEngineOutcomeFeedback(input = {}) {
  const runs = asArray(input.runs || input.outcome_history);
  const matchingRuns = runs.filter((run) => {
    if (input.engine_key && compactString(run.engine_key) !== compactString(input.engine_key)) return false;
    if (input.task_class && compactString(run.task_class) !== compactString(input.task_class)) return false;
    return true;
  });
  const applyRuns = matchingRuns.filter((run) => compactString(run.mode) === "apply" || compactString(run.apply_status) !== "not_requested");
  const failedApplyRuns = applyRuns.filter((run) => ["failed", "blocked"].includes(compactString(run.apply_status)));
  const validatorFailures = matchingRuns.filter((run) => ["failed", "blocked"].includes(compactString(run.validation_status)));
  const recent = matchingRuns.slice(0, 5);
  const recentFailedApply = recent.some((run) => ["failed", "blocked"].includes(compactString(run.apply_status)));
  const recentValidatorFailure = recent.some((run) => ["failed", "blocked"].includes(compactString(run.validation_status)));
  const applySuccesses = applyRuns.filter((run) => compactString(run.apply_status) === "applied").length;
  const applySuccessRate = applyRuns.length ? applySuccesses / applyRuns.length : null;

  const adjustments = [];
  if (recentFailedApply) adjustments.push("prefer_dry_run_after_recent_apply_failure");
  if (recentValidatorFailure) adjustments.push("require_validator_review_after_recent_validator_failure");
  if (applySuccessRate !== null && applySuccessRate < 0.5) adjustments.push("deprioritize_apply_low_success_rate");

  return {
    total_runs: matchingRuns.length,
    apply_runs: applyRuns.length,
    failed_apply_runs: failedApplyRuns.length,
    validator_failures: validatorFailures.length,
    apply_success_rate: applySuccessRate,
    recent_failed_apply: recentFailedApply,
    recent_validator_failure: recentValidatorFailure,
    adjustments,
  };
}

function buildDecisionOptions({ task, policy, selectedStrategy, riskLevel, approvalRequired, validatorCommands, blocks, warnings, matchedSkills, feedback }) {
  const hasBlocks = blocks.length > 0;
  const hasValidators = validatorCommands.length > 0;
  const hasSkillContract = matchedSkills.length > 0;
  const feedbackAdjustments = new Set(feedback?.adjustments || []);
  const feedbackPrefersDryRun =
    feedbackAdjustments.has("prefer_dry_run_after_recent_apply_failure") ||
    feedbackAdjustments.has("require_validator_review_after_recent_validator_failure");
  const feedbackDeprioritizesApply =
    feedbackPrefersDryRun ||
    feedbackAdjustments.has("deprioritize_apply_low_success_rate");
  const options = [{
    option_key: "diagnose_only",
    score: hasBlocks ? 92 : warnings.length ? 70 : 45,
    recommended: hasBlocks || warnings.includes("no_matching_rule_safe_fallback"),
    rationale: hasBlocks
      ? "Blocked or under-specified task must remain diagnostic."
      : "Diagnostic mode remains available as the safest fallback.",
    evidence: [...blocks, ...warnings],
  }];

  if (selectedStrategy) {
    options.push({
      option_key: "dry_run",
      score: feedbackPrefersDryRun ? 96 : hasBlocks && !blocks.every((block) => block === "approval_required") ? 50 : 86,
      recommended: feedbackPrefersDryRun || !hasBlocks || blocks.every((block) => block === "approval_required"),
      rationale: "Dry-run can explain the selected strategy without mutating resources.",
      evidence: [
        `strategy:${selectedStrategy.strategy_key}`,
        `risk:${riskLevel}`,
        hasValidators ? "validators_present" : "validators_missing",
        hasSkillContract ? "skill_contract_present" : "skill_contract_missing",
        ...feedbackAdjustments,
      ],
    });
  }

  if (selectedStrategy && task.requested_mode === "apply_allowed") {
    const applyBlocks = blocks.filter((block) => block !== "approval_required");
    options.push({
      option_key: "apply_strategy",
      score: applyBlocks.length === 0 && !approvalRequired && hasValidators && !feedbackDeprioritizesApply ? 88 : 25,
      recommended: applyBlocks.length === 0 && !approvalRequired && hasValidators && !feedbackDeprioritizesApply,
      rationale: applyBlocks.length === 0 && !approvalRequired && hasValidators && !feedbackDeprioritizesApply
        ? "Apply is policy-allowed, validator-backed, and does not require approval."
        : "Apply is not currently safe enough under policy gates.",
      evidence: [
        `policy_mode:${policy.mode}`,
        `requested_mode:${task.requested_mode}`,
        `risk:${riskLevel}`,
        approvalRequired ? "approval_required" : "approval_not_required",
        hasValidators ? "validators_present" : "validators_missing",
        ...feedbackAdjustments,
        ...applyBlocks,
      ],
    });
  }

  if (approvalRequired || riskAtLeast(riskLevel, "high")) {
    options.push({
      option_key: "manual_review",
      score: approvalRequired ? 90 : 72,
      recommended: approvalRequired,
      rationale: "High-risk or approval-gated tasks should move to manual review before apply.",
      evidence: [`risk:${riskLevel}`, approvalRequired ? "approval_required" : "high_risk"],
    });
  }

  return options
    .sort((a, b) => b.score - a.score)
    .map((option, index) => ({ ...option, rank: index + 1 }));
}

export function evaluatePlatformEngineCapability(input = {}) {
  const engineKey = compactString(input.engine_key);
  const taskClass = compactString(input.task_class);
  const engine = input.engine && typeof input.engine === "object" ? input.engine : null;
  const policies = asArray(input.policies).map(normalizePolicy).filter((policy) => policy.status === "active");
  const rules = asArray(input.rules).map(normalizeRegistryRow).filter((rule) => rule.status === "active");
  const strategies = asArray(input.strategies).map(normalizeStrategy).filter((strategy) => strategy.status === "active");
  const skills = asArray(input.skills).map(normalizeSkill).filter((skill) => skill.status === "active");

  const blocks = [];
  const warnings = [];
  if (!engineKey) blocks.push("missing_engine_key");
  if (!engine) blocks.push("engine_not_registered");
  if (engine && !["active", "available"].includes(compactString(engine.status).toLowerCase())) {
    blocks.push("engine_not_active_or_available");
  }

  const enginePolicies = policies.filter((policy) => !policy.engine_key || policy.engine_key === engineKey);
  if (enginePolicies.length === 0) blocks.push("active_policy_not_found");

  const taskRules = rules.filter((rule) => {
    if (rule.engine_key && rule.engine_key !== engineKey) return false;
    if (taskClass && rule.task_class && rule.task_class !== taskClass) return false;
    return true;
  });
  if (taskClass && taskRules.length === 0) warnings.push("active_task_rules_not_found");

  const strategyKeys = new Set(strategies.map((strategy) => strategy.strategy_key));
  const missingStrategies = taskRules
    .map((rule) => rule.strategy_key)
    .filter((strategyKey) => strategyKey && !strategyKeys.has(strategyKey));
  if (missingStrategies.length > 0) blocks.push("rule_strategy_missing");

  const unsafeStrategies = strategies.filter((strategy) => strategy.executes_dynamic_code).map((strategy) => strategy.strategy_key);
  if (unsafeStrategies.length > 0) blocks.push("dynamic_code_strategy_registered");

  const skillMatches = skills.filter((skill) => {
    if (skill.engine_key && skill.engine_key !== engineKey) return false;
    return !taskClass || skill.task_classes_json.length === 0 || skill.task_classes_json.includes(taskClass);
  });
  if (skillMatches.length === 0) warnings.push("skill_prompt_contract_not_found");

  const validatorCount = [
    ...enginePolicies.flatMap((policy) => policy.validators_json),
    ...taskRules.flatMap((rule) => rule.validator_commands_json),
    ...strategies.flatMap((strategy) => strategy.required_validators_json),
    ...skillMatches.flatMap((skill) => skill.validator_commands_json),
  ].filter(Boolean).length;
  if (validatorCount === 0) warnings.push("validators_not_configured");

  return {
    ok: blocks.length === 0,
    engine_key: engineKey,
    task_class: taskClass || null,
    ready_for_plan: blocks.length === 0,
    ready_for_apply: blocks.length === 0 && taskRules.some((rule) => rule.auto_apply_allowed) && validatorCount > 0,
    counts: {
      policies: enginePolicies.length,
      rules: taskRules.length,
      strategies: strategies.length,
      skills: skillMatches.length,
      validators: validatorCount,
    },
    blocks,
    warnings,
    missing_strategies: [...new Set(missingStrategies)],
    unsafe_strategies: unsafeStrategies,
  };
}

export function planPolicyDrivenEngineTask(input = {}) {
  const classifiedResource = classifyPlatformEngineResource({
    ...(input.resource || {}),
    resource_key: input.resource_key,
    resource_kind: input.resource_kind,
  });
  const task = {
    engine_key: compactString(input.engine_key || input.task?.engine_key),
    task_class: compactString(input.task_class || input.task?.task_class),
    resource_key: classifiedResource.resource_key,
    resource_kind: classifiedResource.resource_kind,
    conflict_type: classifiedResource.conflict_type,
    scope_id: compactString(input.scope_id || input.resource?.scope_id),
    requested_mode: normalizeMode(input.mode || input.requested_mode || "dry_run"),
    scope_guard_passed: input.scope_guard_passed === true || input.scope_guard?.passed === true,
    approval_granted: input.approval_granted === true || input.approval?.granted === true,
  };

  const policy = choosePolicy(task, asArray(input.policies));
  const feedback = input.feedback_summary || summarizePlatformEngineOutcomeFeedback({
    runs: input.outcome_history,
    engine_key: task.engine_key,
    task_class: task.task_class,
    resource_kind: task.resource_kind,
    conflict_type: task.conflict_type,
  });
  const allRules = asArray(input.rules).map(normalizeRegistryRow);
  const matchedRules = allRules
    .filter((rule) => ruleMatchesTask(rule, task))
    .sort((a, b) => b.priority - a.priority);
  const strategies = new Map(asArray(input.strategies).map((row) => {
    const strategy = normalizeStrategy(row);
    return [strategy.strategy_key, strategy];
  }));
  const matchedSkills = chooseSkills(task, matchedRules, asArray(input.skills));

  const blocks = [];
  const warnings = [];
  if (!task.engine_key) blocks.push("missing_engine_key");
  if (!task.task_class) blocks.push("missing_task_class");
  if (policy.require_scope_guard && !task.scope_guard_passed) blocks.push("scope_guard_required");
  blocks.push(...classifyResource(task, policy));

  const explicitDeny = matchedRules.find((rule) => rule.deny);
  if (explicitDeny) blocks.push("explicit_deny_rule_matched");

  const selectedRule = explicitDeny || matchedRules.find((rule) => rule.strategy_key);
  const selectedStrategy = selectedRule ? strategies.get(selectedRule.strategy_key) : null;
  if (!selectedRule) warnings.push("no_matching_rule_safe_fallback");
  if (selectedRule && !selectedStrategy) blocks.push("strategy_not_registered");
  if (selectedStrategy && !strategyAvailable(selectedStrategy, task)) blocks.push("strategy_not_available_or_safe");

  const riskLevel = normalizeRisk(selectedRule?.risk_level || selectedStrategy?.risk_level || policy.risk_default);
  const approvalRequired = Boolean(
    selectedRule?.approval_required ||
    riskAtLeast(riskLevel, policy.approval_required_min_risk)
  );
  if (approvalRequired && !task.approval_granted) blocks.push("approval_required");

  const validatorCommands = [
    ...policy.validators_json,
    ...(selectedStrategy?.required_validators_json || []),
    ...(selectedRule?.validator_commands_json || []),
    ...matchedSkills.flatMap((skill) => skill.validator_commands_json),
  ].filter(Boolean);

  if (policy.require_validators && validatorCommands.length === 0) {
    blocks.push("validators_required");
  }

  const requestedApply = task.requested_mode === "apply_allowed";
  if (requestedApply && policy.mode !== "apply_allowed") blocks.push("policy_blocks_apply");
  if (requestedApply && selectedRule && !selectedRule.auto_apply_allowed) blocks.push("rule_blocks_auto_apply");
  if (requestedApply && !validatorCommands.length) blocks.push("apply_requires_validators");

  const effectiveMode = blocks.length > 0 || policy.mode === SAFE_FALLBACK_MODE
    ? SAFE_FALLBACK_MODE
    : requestedApply
      ? "apply_allowed"
      : "dry_run";

  const decisionOptions = buildDecisionOptions({
    task,
    policy,
    selectedStrategy,
    riskLevel,
    approvalRequired,
    validatorCommands,
    blocks,
    warnings,
    matchedSkills,
    feedback,
  });

  const plan = selectedRule && selectedStrategy && !selectedStrategy.executes_dynamic_code
    ? [{
        resource: task.resource_key,
        resource_kind: task.resource_kind,
        strategy_key: selectedStrategy.strategy_key,
        risk_level: riskLevel,
        mode: effectiveMode,
        validators: validatorCommands,
        approval_required: approvalRequired,
        skills: matchedSkills.map((skill) => skill.skill_key),
      }]
    : [];

  return {
    ok: blocks.length === 0,
    intelligence_layer: "ai_intelligence_runtime_governance_v1",
    decision_model_role: "scoring_assist_only",
    hard_gates_deterministic: true,
    engine_key: task.engine_key,
    task_class: task.task_class,
    resource_kind: task.resource_kind,
    conflict_type: task.conflict_type,
    mode: effectiveMode,
    policy_key: policy.policy_key,
    policy_source: policy.policy_key === "safe_fallback" ? "safe_fallback" : "sql_registry",
    matched_rules: matchedRules.map((rule) => rule.rule_key).filter(Boolean),
    selected_strategy: selectedStrategy?.strategy_key || null,
    risk_level: riskLevel,
    approval_required: approvalRequired,
    scope_guard_required: policy.require_scope_guard,
    recommended_decision: decisionOptions.find((option) => option.recommended)?.option_key || decisionOptions[0]?.option_key || "diagnose_only",
    decision_options: decisionOptions,
    feedback_summary: feedback,
    hard_gates: {
      scope_guard: policy.require_scope_guard,
      approval_required: approvalRequired,
      validators_required: policy.require_validators,
      readback_required: true,
      model_may_override: false,
    },
    validators: validatorCommands,
    skills: matchedSkills.map((skill) => ({
      skill_key: skill.skill_key,
      required_tools: skill.required_tools_json,
      forbidden_tools: skill.forbidden_tools_json,
      success_criteria: skill.success_criteria_json,
    })),
    plan,
    blocked: blocks,
    warnings,
  };
}

export function buildPlatformEngineExecutionEnvelope(plan = {}, input = {}) {
  const requestedApply = plan.mode === "apply_allowed" || input.mode === "apply_allowed";
  const hasValidators = Array.isArray(plan.validators) && plan.validators.length > 0;
  const approvalSatisfied = plan.approval_required !== true || input.approval_granted === true || input.approval?.granted === true;
  const scopeSatisfied = plan.scope_guard_required !== true || input.scope_guard_passed === true || input.scope_guard?.passed === true;
  const recommendedApply = plan.recommended_decision === "apply_strategy";
  const blockers = [
    ...(Array.isArray(plan.blocked) ? plan.blocked : []),
    requestedApply ? null : "apply_mode_not_requested",
    plan.ok === true ? null : "plan_not_ok",
    hasValidators ? null : "validators_required",
    approvalSatisfied ? null : "approval_required",
    scopeSatisfied ? null : "scope_guard_required",
    recommendedApply ? null : "planner_did_not_recommend_apply",
  ].filter(Boolean);

  return {
    ok: blockers.length === 0,
    envelope_type: "platform_engine_apply_readiness_envelope_v1",
    intelligence_layer: "ai_intelligence_runtime_governance_v1",
    model_executes_tools: false,
    tool_execution_runtime_separate: true,
    engine_key: plan.engine_key || input.engine_key || "",
    task_class: plan.task_class || input.task_class || "",
    mode: requestedApply ? "apply_envelope" : "diagnostic_envelope",
    can_apply: blockers.length === 0,
    will_execute: false,
    no_execution: true,
    no_repo_mutation: true,
    policy_key: plan.policy_key || null,
    selected_strategy: plan.selected_strategy || null,
    recommended_decision: plan.recommended_decision || "diagnose_only",
    risk_level: plan.risk_level || "medium",
    required_controls: {
      scope_guard_required: plan.scope_guard_required === true,
      scope_guard_satisfied: scopeSatisfied,
      approval_required: plan.approval_required === true,
      approval_satisfied: approvalSatisfied,
      validators_required: true,
      validators_present: hasValidators,
      readback_required: true,
      audit_required: true,
    },
    validators: plan.validators || [],
    skills: plan.skills || [],
    blockers,
    next_step: blockers.length === 0
      ? "ready_for_separate_governed_apply_route"
      : "resolve_envelope_blockers_before_apply",
  };
}

export const PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS = Object.freeze({
  safe_fallback_mode: SAFE_FALLBACK_MODE,
  no_db_stored_executable_code: true,
  model_never_executes_tools: true,
  tool_execution_runtime_separate: true,
  tool_catalog_raw_exposure: false,
  deterministic_hard_gates: true,
  skill_requires_policy_eval_tool_contract: true,
  side_effects_require_readback: true,
  require_scope_guard_by_default: true,
  approval_required_min_risk_default: "high",
  supported_risk_levels: RISK_ORDER,
});
