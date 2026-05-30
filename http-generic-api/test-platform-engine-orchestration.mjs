import assert from "node:assert/strict";
import { buildPlatformEngineDecisionBrief, writePlatformEngineRun } from "./platformEngineRegistry.js";
import {
  buildDatabaseTableLifecycleDecisionBrief,
  buildDatabaseTableLifecycleRegisterPlan,
  classifyDatabaseTableLifecycle,
} from "./databaseTableLifecycle.js";
import {
  buildPlatformEngineExecutionEnvelope,
  classifyPlatformEngineResource,
  evaluatePlatformEngineCapability,
  PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS,
  planPolicyDrivenEngineTask,
  resolvePlatformEngineIntent,
  summarizePlatformEngineOutcomeFeedback,
} from "./platformEngineOrchestration.js";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/166_sprint65_ai_intelligence_runtime_governance.sql", import.meta.url),
  "utf8"
);
const toolsMigration = fs.readFileSync(
  new URL("./migrations/167_sprint65_ai_intelligence_runtime_governance_tools.sql", import.meta.url),
  "utf8"
);
const lifecycleMigration = fs.readFileSync(
  new URL("./migrations/168_sprint65_database_table_lifecycle_governance.sql", import.meta.url),
  "utf8"
);
const routesIndex = fs.readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const engineRoutes = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const tenantOpenApi = fs.readFileSync(new URL("./openapi.tenant-gpt.auth.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_policy_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_policy_rules"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_strategy_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_skill_prompt_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_engine_execution_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS intelligence_engines"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS intelligence_policies"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS intelligence_policy_rules"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS skill_manifests"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS decision_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS ai_model_providers"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS ai_model_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS agent_tool_index"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS agent_model_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS agent_tool_calls"));
assert(migration.includes("repo_conflict_resolution_engine"));
assert(migration.includes("schema_cleanup_engine"));
assert(migration.includes("provider_smoke_certification_engine"));
assert(migration.includes("release_readiness_engine"));
assert(migration.includes("activation_validation_engine"));
assert(migration.includes("canonical_agent_runtime_engine"));
assert(migration.includes("model_never_executes_tools"));
assert(migration.includes("tool_execution_runtime_separate"));
assert(migration.includes("source_truth_resource_type ENUM('action','endpoint','workflow','connected_system','mcp_import','local_tool','other')"));
assert(migration.includes("no_raw_thinking_stored TINYINT(1) NOT NULL DEFAULT 1"));
assert(migration.includes("secrets_returned_to_model TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("side_effect_confirmed_by_readback TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("model_decision_role ENUM('none','candidate_generation','scoring_assist','explanation_only')"));
assert(migration.includes("model_may_override TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("policy_key VARCHAR(191) NOT NULL"));
assert(migration.includes("eval_suite_key VARCHAR(191) NOT NULL"));
assert(migration.includes("tool_policy_json JSON NOT NULL"));
assert(lifecycleMigration.includes("CREATE TABLE IF NOT EXISTS database_table_lifecycle_registry"));
assert(lifecycleMigration.includes("database_table_lifecycle_engine"));
assert(lifecycleMigration.includes("session_memory_lifecycle_engine"));
assert(lifecycleMigration.includes("observability_lifecycle_engine"));
assert(lifecycleMigration.includes("repair_archive_engine"));
assert(lifecycleMigration.includes("platform_graph_memory_lifecycle_engine"));
assert(lifecycleMigration.includes("commercial_lifecycle_engine"));
assert(lifecycleMigration.includes("INSERT INTO intelligence_engines"));
assert(lifecycleMigration.includes("INSERT INTO skill_manifests"));
assert(lifecycleMigration.includes("drop_truncate_delete_forbidden"));
assert(lifecycleMigration.includes("DROP/TRUNCATE/DELETE are explicitly outside this policy"));
for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(migration), `engine migration must not include destructive SQL statement ${destructiveSql}`);
  assert(!destructiveSql.test(toolsMigration), `tools migration must not include destructive SQL statement ${destructiveSql}`);
  assert(!destructiveSql.test(lifecycleMigration), `lifecycle migration must not include destructive SQL statement ${destructiveSql}`);
}
assert(migration.includes("executes_dynamic_code TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("'manual_only'"));
assert(migration.includes("'repo_conflict_auth_manual_only'"));
assert(migration.includes('"git push"'));
assert(!migration.includes("implementation_code"), "migration must not store executable implementation code");
assert(toolsMigration.includes("platform_engine_list"));
assert(toolsMigration.includes("platform_engine_task_plan"));
assert(toolsMigration.includes("platform_engine_resolve_intent"));
assert(toolsMigration.includes("platform_engine_decision_brief"));
assert(toolsMigration.includes("database_table_lifecycle_decision_brief"));
assert(toolsMigration.includes("database_table_lifecycle_register_plan"));
assert(toolsMigration.includes("platform_engine_capability_check"));
assert(toolsMigration.includes("platform_engine_run_history"));
assert(toolsMigration.includes("platform_engine_feedback_summary"));
assert(toolsMigration.includes("platform_engine_execution_envelope"));
assert(toolsMigration.includes("Dry-run planning only"));
assert(toolsMigration.includes("no_dynamic_code"));
assert(!toolsMigration.includes("platform_engine_task_apply"), "apply tool must not be exposed in this phase");
assert(routesIndex.includes("buildPlatformEngineRoutes"));
assert(engineRoutes.includes('router.post("/platform/engines/task-plan"'));
assert(engineRoutes.includes('router.post("/platform/engines/resolve-intent"'));
assert(engineRoutes.includes('router.post("/platform/engines/decision-brief"'));
assert(engineRoutes.includes('router.post("/platform/engines/database-table-lifecycle/decision-brief"'));
assert(engineRoutes.includes('router.post("/platform/engines/database-table-lifecycle/register-plan"'));
assert(engineRoutes.includes('router.post("/platform/engines/capability-check"'));
assert(engineRoutes.includes('router.get("/platform/engines/feedback-summary"'));
assert(engineRoutes.includes('router.post("/platform/engines/execution-envelope"'));
assert(engineRoutes.includes("write_audit"));
assert(!engineRoutes.includes('router.post("/platform/engines/task-apply"'), "apply route must not exist in this phase");
assert(!/router\.(delete|put|patch)\(/.test(engineRoutes), "platform engine routes must expose only read/plan GET+POST surfaces");
assert(!tenantOpenApi.includes("/platform/engines"), "platform engine admin routes must not be exposed in tenant GPT OpenAPI");
assert(!tenantOpenApi.includes("platform_engine_"), "platform engine admin tools must not be exposed in tenant GPT OpenAPI");
assert(!tenantOpenApi.includes("database_table_lifecycle"), "database lifecycle admin tools must not be exposed in tenant GPT OpenAPI");

const policies = [
  {
    policy_key: "platform_engine_default_v1",
    mode: "dry_run",
    approval_required_min_risk: "high",
    require_scope_guard: true,
    require_audit: true,
    require_validators: true,
    blocked_resource_patterns_json: [".env", "secrets/**"],
    status: "active",
  },
  {
    policy_key: "repo_conflict_policy_v1",
    engine_key: "repo_conflict_resolution_engine",
    mode: "apply_allowed",
    approval_required_min_risk: "high",
    require_scope_guard: true,
    require_validators: true,
    allowed_resource_patterns_json: ["http-generic-api/**", "schemas/**", "docs/**", "memory_schema.json"],
    blocked_resource_patterns_json: [".env", "**/secrets/**"],
    validators_json: ["node test-repo-patch-apply.mjs"],
    status: "active",
  },
];

const strategies = [
  {
    strategy_key: "json_script_insert",
    supported_task_classes_json: ["conflict_plan", "conflict_apply"],
    supported_resource_kinds_json: ["json"],
    required_validators_json: ["node -e \"JSON.parse(require('fs').readFileSync('package.json','utf8'))\""],
    risk_level: "medium",
    status: "active",
  },
  {
    strategy_key: "json_schema_field_transform",
    supported_task_classes_json: ["conflict_plan", "schema_cleanup"],
    supported_resource_kinds_json: ["json_schema"],
    required_validators_json: ["node ../validate-memory-schema.mjs"],
    risk_level: "medium",
    status: "active",
  },
  {
    strategy_key: "manual_only",
    supported_task_classes_json: ["conflict_plan", "conflict_apply"],
    risk_level: "high",
    status: "active",
  },
  {
    strategy_key: "unsafe_inline_js",
    supported_task_classes_json: ["conflict_plan"],
    metadata_json: { implementation_code: "process.exit(0)" },
    risk_level: "critical",
    status: "active",
  },
];

const rules = [
  {
    rule_key: "package_json_script_conflict",
    engine_key: "repo_conflict_resolution_engine",
    task_class: "conflict_plan",
    resource_pattern: "http-generic-api/package.json",
    strategy_key: "json_script_insert",
    risk_level: "medium",
    auto_apply_allowed: true,
    validator_commands_json: ["node test-platform-engine-orchestration.mjs"],
    required_skill_keys_json: ["repo_conflict_resolution"],
    priority: 100,
    status: "active",
  },
  {
    rule_key: "auth_conflict_manual_only",
    engine_key: "repo_conflict_resolution_engine",
    task_class: "conflict_plan",
    resource_pattern: "http-generic-api/auth*.js",
    strategy_key: "manual_only",
    risk_level: "high",
    auto_apply_allowed: false,
    approval_required: true,
    priority: 200,
    status: "active",
  },
  {
    rule_key: "unsafe_inline_strategy_rejected",
    engine_key: "repo_conflict_resolution_engine",
    task_class: "conflict_plan",
    resource_pattern: "http-generic-api/unsafe.json",
    strategy_key: "unsafe_inline_js",
    risk_level: "critical",
    auto_apply_allowed: true,
    priority: 300,
    status: "active",
  },
  {
    rule_key: "provider_smoke_get_probe",
    engine_key: "provider_smoke_certification_engine",
    task_class: "certify_plugin",
    resource_pattern: "plugin:*",
    strategy_key: "provider_smoke_run",
    risk_level: "medium",
    auto_apply_allowed: false,
    priority: 50,
    status: "active",
  },
];

const skills = [
  {
    skill_key: "repo_conflict_resolution",
    engine_key: "repo_conflict_resolution_engine",
    task_classes_json: ["conflict_plan", "conflict_apply"],
    required_tools_json: ["engine_task_diagnose", "engine_task_plan", "scope_guard"],
    forbidden_tools_json: ["git push", "force_update", "secret_read"],
    validator_commands_json: ["node test-repo-patch-apply.mjs"],
    success_criteria_json: ["branch_mergeable", "diff_within_allowed_scope", "validators_pass"],
    status: "active",
  },
];

const readyCapability = evaluatePlatformEngineCapability({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  engine: { engine_key: "repo_conflict_resolution_engine", status: "active" },
  policies,
  rules: rules.filter((rule) => rule.rule_key !== "unsafe_inline_strategy_rejected"),
  strategies: strategies.filter((strategy) => strategy.strategy_key !== "unsafe_inline_js"),
  skills,
});

assert.equal(readyCapability.ok, true);
assert.equal(readyCapability.ready_for_plan, true);
assert.equal(readyCapability.ready_for_apply, true);
assert.equal(readyCapability.counts.policies > 0, true);
assert.equal(readyCapability.counts.rules > 0, true);
assert.equal(readyCapability.counts.validators > 0, true);

const missingCapability = evaluatePlatformEngineCapability({
  engine_key: "unknown_engine",
  task_class: "conflict_plan",
  policies: [],
  rules: [],
  strategies: [],
  skills: [],
});

assert.equal(missingCapability.ok, false);
assert(missingCapability.blocks.includes("engine_not_registered"));
assert(missingCapability.blocks.includes("active_policy_not_found"));

const unsafeCapability = evaluatePlatformEngineCapability({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  engine: { engine_key: "repo_conflict_resolution_engine", status: "active" },
  policies,
  rules,
  strategies: [{ strategy_key: "unsafe_inline_js", executes_dynamic_code: true, status: "active" }],
  skills,
});

assert.equal(unsafeCapability.ok, false);
assert(unsafeCapability.blocks.includes("rule_strategy_missing"));
assert(unsafeCapability.blocks.includes("dynamic_code_strategy_registered"));

assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.no_db_stored_executable_code, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.model_never_executes_tools, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.tool_execution_runtime_separate, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.tool_catalog_raw_exposure, false);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.deterministic_hard_gates, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.skill_requires_policy_eval_tool_contract, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.side_effects_require_readback, true);
assert.equal(PLATFORM_ENGINE_ORCHESTRATION_GUARDRAILS.safe_fallback_mode, "diagnose_only");
assert.deepEqual(classifyPlatformEngineResource({ path: "http-generic-api/package.json" }), {
  resource_key: "http-generic-api/package.json",
  resource_kind: "json",
  conflict_type: "package_json_script_conflict",
});
assert.equal(classifyPlatformEngineResource({ path: "http-generic-api/migrations/160.sql" }).conflict_type, "migration_conflict");
assert.equal(classifyPlatformEngineResource({ path: "memory_schema.json" }).resource_kind, "json_schema");

assert.equal(resolvePlatformEngineIntent({
  objective: "resolve merge conflict without scope creep",
  resource_key: "http-generic-api/package.json",
}).engine_key, "repo_conflict_resolution_engine");
assert.equal(resolvePlatformEngineIntent({
  objective: "cleanup memory_schema SQL authority contract",
  resource_key: "memory_schema.json",
}).task_class, "schema_plan");
assert.equal(resolvePlatformEngineIntent({
  objective: "certify plugin provider smoke",
}).engine_key, "provider_smoke_certification_engine");
assert.equal(resolvePlatformEngineIntent({
  objective: "run database table lifecycle census and classify archive candidates",
}).engine_key, "database_table_lifecycle_engine");
assert.equal(resolvePlatformEngineIntent({
  objective: "unknown objective",
}).task_class, "diagnose");

assert.equal(classifyDatabaseTableLifecycle({
  table_name: "session_events",
  approx_rows: 1000,
  size_mb: 32.875,
  column_names: ["session_id", "tenant_id", "created_at"],
}).owner_engine_key, "session_memory_lifecycle_engine");
assert.equal(classifyDatabaseTableLifecycle({
  table_name: "repair_backup_actions",
  approx_rows: 12,
}).usage_status, "backup_snapshot");
assert.equal(classifyDatabaseTableLifecycle({
  table_name: "commercial_profiles",
  approx_rows: 0,
  column_names: ["tenant_id", "status"],
}).owner_engine_key, "commercial_lifecycle_engine");
assert.equal(classifyDatabaseTableLifecycle({
  table_name: "empty_placeholder",
  approx_rows: 0,
}).usage_status, "planned_placeholder");

const lifecycleBrief = buildDatabaseTableLifecycleDecisionBrief([
  { table_name: "session_events", approx_rows: 1000, size_mb: 32.875, column_names: ["session_id", "tenant_id"] },
  { table_name: "gpt_session_turns", approx_rows: 500, size_mb: 16.016, column_names: ["session_id"] },
  { table_name: "telemetry_spans", approx_rows: 300, size_mb: 9.094, column_names: ["trace_id"] },
  { table_name: "repair_backup_actions", approx_rows: 12, size_mb: 1 },
  { table_name: "empty_placeholder", approx_rows: 0, size_mb: 0 },
]);
assert.equal(lifecycleBrief.no_drop, true);
assert.equal(lifecycleBrief.no_archive_execution, true);
assert.equal(lifecycleBrief.engine_key, "database_table_lifecycle_engine");
assert(lifecycleBrief.summary.high_risk_count >= 1);
assert(lifecycleBrief.buckets.clearly_used.includes("session_events"));
assert(lifecycleBrief.buckets.archive_candidate.includes("repair_backup_actions"));
assert(lifecycleBrief.buckets.link_to_engine_policy_audit.includes("empty_placeholder"));
assert(lifecycleBrief.priority_actions.includes("register_all_untracked_tables_in_lifecycle_registry"));

const lifecycleRegisterPlan = buildDatabaseTableLifecycleRegisterPlan([
  { table_name: "session_events", approx_rows: 1000, size_mb: 32.875, column_names: ["session_id", "tenant_id"] },
  { table_name: "repair_backup_actions", approx_rows: 12, size_mb: 1 },
]);
assert.equal(lifecycleRegisterPlan.dry_run, true);
assert.equal(lifecycleRegisterPlan.will_write, false);
assert.equal(lifecycleRegisterPlan.target_table, "database_table_lifecycle_registry");
assert(lifecycleRegisterPlan.buckets.clearly_used.includes("session_events"));
assert(lifecycleRegisterPlan.buckets.archive_candidate.includes("repair_backup_actions"));
assert.equal(lifecycleRegisterPlan.upsert_count, 2);
assert.equal(lifecycleRegisterPlan.upsert_rows[0].owner_engine_key, "session_memory_lifecycle_engine");
assert.equal(lifecycleRegisterPlan.upsert_rows[1].usage_status, "backup_snapshot");

function makeEngineBriefPool() {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM platform_engine_registry")) {
        return [[{
          engine_key: "repo_conflict_resolution_engine",
          display_name: "Repository Conflict Resolution Engine",
          engine_type: "repo_maintenance",
          runtime_key: "codex_essam_chatgpt_v1",
          supported_task_classes_json: JSON.stringify(["conflict_plan"]),
          capabilities_json: JSON.stringify({ supports_sql_policy: true }),
          default_policy_key: "repo_conflict_policy_v1",
          status: "active",
        }]];
      }
      if (sql.includes("FROM platform_engine_policy_registry")) return [[...policies]];
      if (sql.includes("FROM platform_engine_policy_rules")) return [[rules[0]]];
      if (sql.includes("FROM platform_engine_strategy_registry")) return [[strategies[0]]];
      if (sql.includes("FROM platform_engine_skill_prompt_registry")) return [[skills[0]]];
      if (sql.includes("FROM platform_engine_execution_runs")) return [[]];
      throw new Error(`unexpected query: ${sql} ${params.join(",")}`);
    },
  };
}

const decisionBrief = await buildPlatformEngineDecisionBrief({
  objective: "resolve package conflict",
  resource_key: "http-generic-api/package.json",
  mode: "apply_allowed",
  scope_guard_passed: true,
}, { pool: makeEngineBriefPool() });

assert.equal(decisionBrief.ok, true);
assert.equal(decisionBrief.intent.engine_key, "repo_conflict_resolution_engine");
assert.equal(decisionBrief.decision_inputs.resource_key, "http-generic-api/package.json");
assert.equal(decisionBrief.decision_outputs.recommended_decision, "apply_strategy");
assert.equal(decisionBrief.decision_outputs.can_apply, true);
assert.equal(decisionBrief.capability.ready_for_plan, true);
assert.equal(decisionBrief.plan.recommended_decision, "apply_strategy");
assert.equal(decisionBrief.envelope.will_execute, false);
assert.equal(decisionBrief.envelope.no_repo_mutation, true);
assert.equal(decisionBrief.envelope.model_executes_tools, false);
assert.equal(decisionBrief.envelope.tool_execution_runtime_separate, true);

let capturedAuditParams = null;
await writePlatformEngineRun({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  mode: "dry_run",
  policy_key: "repo_conflict_policy_v1",
  risk_level: "medium",
  matched_rules: ["package_json_script_conflict"],
  skills: [{ skill_key: "repo_conflict_resolution" }],
  blocked: [],
  resource: {
    path: "http-generic-api/package.json",
    api_key: "must-not-be-written",
    nested: {
      password: "must-not-be-written-either",
      token: "also-secret",
    },
  },
}, {
  run_id: "test_run_sanitized",
  actor_id: "tester",
}, {
  pool: {
    async query(_sql, params) {
      capturedAuditParams = params;
      return [{ affectedRows: 1 }];
    },
  },
});
const auditPlanJson = String(capturedAuditParams[8]);
assert(!auditPlanJson.includes("must-not-be-written"));
assert(!auditPlanJson.includes("must-not-be-written-either"));
assert(!auditPlanJson.includes("also-secret"));
assert(auditPlanJson.includes("[redacted]"));
assert.equal(capturedAuditParams[4], "dry_run", "planning audit must not be recorded as apply without an apply route");

const packagePlan = planPolicyDrivenEngineTask({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  resource: { path: "http-generic-api/package.json" },
  mode: "apply_allowed",
  scope_guard_passed: true,
  policies,
  rules,
  strategies,
  skills,
});

assert.equal(packagePlan.ok, true);
assert.equal(packagePlan.mode, "apply_allowed");
assert.equal(packagePlan.policy_key, "repo_conflict_policy_v1");
assert.equal(packagePlan.selected_strategy, "json_script_insert");
assert.equal(packagePlan.resource_kind, "json");
assert.equal(packagePlan.conflict_type, "package_json_script_conflict");
assert.equal(packagePlan.risk_level, "medium");
assert.equal(packagePlan.approval_required, false);
assert.equal(packagePlan.intelligence_layer, "ai_intelligence_runtime_governance_v1");
assert.equal(packagePlan.decision_model_role, "scoring_assist_only");
assert.equal(packagePlan.hard_gates_deterministic, true);
assert.equal(packagePlan.hard_gates.model_may_override, false);
assert.equal(packagePlan.hard_gates.readback_required, true);
assert.equal(packagePlan.recommended_decision, "apply_strategy");
assert.equal(packagePlan.decision_options[0].option_key, "apply_strategy");
assert(packagePlan.validators.includes("node test-repo-patch-apply.mjs"));
assert.equal(packagePlan.skills[0].skill_key, "repo_conflict_resolution");
assert(packagePlan.skills[0].forbidden_tools.includes("git push"));

const readyEnvelope = buildPlatformEngineExecutionEnvelope(packagePlan, {
  mode: "apply_allowed",
  scope_guard_passed: true,
});
assert.equal(readyEnvelope.can_apply, true);
assert.equal(readyEnvelope.will_execute, false);
assert.equal(readyEnvelope.no_repo_mutation, true);
assert.equal(readyEnvelope.required_controls.readback_required, true);
assert.equal(readyEnvelope.next_step, "ready_for_separate_governed_apply_route");

const feedbackSummary = summarizePlatformEngineOutcomeFeedback({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  runs: [
    {
      engine_key: "repo_conflict_resolution_engine",
      task_class: "conflict_plan",
      mode: "apply",
      apply_status: "failed",
      validation_status: "failed",
    },
  ],
});
assert.equal(feedbackSummary.recent_failed_apply, true);
assert(feedbackSummary.adjustments.includes("prefer_dry_run_after_recent_apply_failure"));

const packagePlanAfterFailure = planPolicyDrivenEngineTask({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  resource: { path: "http-generic-api/package.json", kind: "json" },
  mode: "apply_allowed",
  scope_guard_passed: true,
  policies,
  rules,
  strategies,
  skills,
  outcome_history: [
    {
      engine_key: "repo_conflict_resolution_engine",
      task_class: "conflict_plan",
      mode: "apply",
      apply_status: "failed",
      validation_status: "failed",
    },
  ],
});

assert.equal(packagePlanAfterFailure.recommended_decision, "dry_run");
assert.equal(packagePlanAfterFailure.decision_options[0].option_key, "dry_run");
assert(packagePlanAfterFailure.feedback_summary.adjustments.includes("prefer_dry_run_after_recent_apply_failure"));

const blockedEnvelope = buildPlatformEngineExecutionEnvelope(packagePlanAfterFailure, {
  mode: "apply_allowed",
  scope_guard_passed: true,
});
assert.equal(blockedEnvelope.can_apply, false);
assert(blockedEnvelope.blockers.includes("planner_did_not_recommend_apply"));

const authPlan = planPolicyDrivenEngineTask({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  resource: { path: "http-generic-api/authCredentialResolution.js", kind: "javascript" },
  mode: "apply_allowed",
  scope_guard_passed: true,
  policies,
  rules,
  strategies,
  skills,
});

assert.equal(authPlan.ok, false);
assert.equal(authPlan.mode, "diagnose_only");
assert.equal(authPlan.approval_required, true);
assert.equal(authPlan.recommended_decision, "diagnose_only");
assert(authPlan.decision_options.some((option) => option.option_key === "manual_review"));
assert(authPlan.blocked.includes("explicit_deny_rule_matched"));
assert(authPlan.blocked.includes("approval_required"));

const missingScopeGuard = planPolicyDrivenEngineTask({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  resource: { path: "http-generic-api/package.json", kind: "json" },
  mode: "dry_run",
  policies,
  rules,
  strategies,
  skills,
});

assert.equal(missingScopeGuard.ok, false);
assert(missingScopeGuard.blocked.includes("scope_guard_required"));

const unsafeStrategy = planPolicyDrivenEngineTask({
  engine_key: "repo_conflict_resolution_engine",
  task_class: "conflict_plan",
  resource: { path: "http-generic-api/unsafe.json", kind: "json" },
  mode: "apply_allowed",
  scope_guard_passed: true,
  approval_granted: true,
  policies,
  rules,
  strategies,
  skills,
});

assert.equal(unsafeStrategy.ok, false);
assert(unsafeStrategy.blocked.includes("strategy_not_available_or_safe"));

const unknownEngine = planPolicyDrivenEngineTask({
  engine_key: "schema_cleanup_engine",
  task_class: "schema_cleanup",
  resource: { path: "memory_schema.json", kind: "json_schema" },
  mode: "apply_allowed",
  scope_guard_passed: true,
  policies,
  rules,
  strategies,
});

assert.equal(unknownEngine.ok, false);
assert.equal(unknownEngine.mode, "diagnose_only");
assert.equal(unknownEngine.recommended_decision, "diagnose_only");
assert(unknownEngine.warnings.includes("no_matching_rule_safe_fallback"));

console.log("platform engine orchestration contract tests passed");
