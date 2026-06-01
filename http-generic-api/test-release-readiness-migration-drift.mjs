import assert from "node:assert/strict";
import {
  assessMigrationSqlPreflight,
  buildMigrationDriftApplyPlan,
  classifyMigrationDriftMissing,
  extractMigrationReadinessRequirementsFromSql,
  extractNamedToolKeysFromSource,
} from "./releaseReadiness.js";

const sampleSql = `
CREATE TABLE IF NOT EXISTS platform_resource_authority_requirements (
  requirement_key VARCHAR(191) NOT NULL PRIMARY KEY
);
CREATE OR REPLACE VIEW v_resource_authority_sample AS SELECT 1 AS ok;
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('resource_authority_decision_brief', 'Resource Authority Decision Brief', 'Read-only.', 'POST', '/platform/engines/decision-brief', NULL, JSON_OBJECT('type', 'object', 'tenant_id', 'abc'), JSON_OBJECT('environment', 'production'), 'read_only', 1, 268),
  ('github_ci_recovery_decision_brief', 'GitHub CI Recovery Decision Brief', 'Read-only.', 'POST', '/platform/engines/decision-brief', NULL, '{}', '{}', 'read_only', 1, 269);
INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('tenant_system_tools_list', 'Tenant Tools List', 'Read-only.', 'GET', '/system/tools', NULL, '{}', '{}', 'read_only', 1, 1);
INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json, capabilities_json, default_policy_key, status, notes)
VALUES
  ('resource_authority_engine', 'Resource Authority Engine', 'generic', 'runtime', '[]', '{}', 'resource_authority_policy_v1', 'active', 'test');
INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, mode, risk_default, status)
VALUES
  ('resource_authority_policy_v1', 'resource_authority_engine', 'global', 'diagnose_only', 'high', 'active');
INSERT INTO platform_engine_strategy_registry
  (strategy_key, display_name, description, supported_engine_types_json, supported_task_classes_json, supported_resource_kinds_json, status)
VALUES
  ('resource_authority_gate_check', 'Gate Check', 'Read-only.', '[]', '[]', '[]', 'active');
INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, status)
VALUES
  ('resource_authority_publish_gate', 'resource_authority_policy_v1', 'resource_authority_engine', 100, 'publish_readiness_plan', 'resource_authority_requirement', 'active');
INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version, task_classes_json, status)
VALUES
  ('resource_authority', 'resource_authority_engine', 'Resource Authority', 'v1', '[]', 'active');
`;

const requirements = extractMigrationReadinessRequirementsFromSql(sampleSql);

assert(requirements.schema_objects.includes("platform_resource_authority_requirements"), "must detect CREATE TABLE objects");
assert(requirements.schema_objects.includes("v_resource_authority_sample"), "must detect CREATE VIEW objects");
assert(requirements.admin_tools.includes("resource_authority_decision_brief"), "must detect first admin tool tuple");
assert(requirements.admin_tools.includes("github_ci_recovery_decision_brief"), "must detect later admin tool tuples");
assert(!requirements.admin_tools.includes("type"), "must not treat JSON_OBJECT keys as tool keys");
assert(!requirements.admin_tools.includes("tenant_id"), "must not treat nested JSON keys as tool keys");
assert(!requirements.admin_tools.includes("environment"), "must not treat fixed_body JSON keys as tool keys");
assert(!requirements.admin_tools.includes("production"), "must not treat fixed_body JSON values as tool keys");
assert(requirements.tenant_tools.includes("tenant_system_tools_list"), "must detect tenant tool tuples");
assert(requirements.engines.includes("resource_authority_engine"), "must detect platform engine rows");
assert(requirements.engine_policies.includes("resource_authority_policy_v1"), "must detect engine policy rows");
assert(requirements.engine_strategies.includes("resource_authority_gate_check"), "must detect engine strategy rows");
assert(requirements.engine_rules.includes("resource_authority_publish_gate"), "must detect engine policy rule rows");
assert(requirements.engine_skills.includes("resource_authority"), "must detect engine skill prompt rows");

const sourceToolNames = extractNamedToolKeysFromSource(`
  const TOOLS = [
    { name: "activation_sheets_bootstrap_read" },
    { name: "repo_inspect" },
  ];
`);
assert(sourceToolNames.includes("activation_sheets_bootstrap_read"), "must extract source tool names");
assert(sourceToolNames.includes("repo_inspect"), "must extract virtual source tool names");

const classified = classifyMigrationDriftMissing(
  {
    schema_objects: ["cms_sites"],
    admin_tools: ["activation_sheets_bootstrap_read", "repo_inspect", "missing_admin_tool"],
    tenant_tools: ["tenant_missing_tool"],
    engines: ["commercial_lifecycle_engine"],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  },
  {
    system_layer_tools: ["activation_sheets_bootstrap_read"],
    virtual_admin_tools: ["repo_inspect"],
  }
);
assert.deepEqual(classified.classification.schema_objects.migration_apply_candidate, ["cms_sites"], "schema gaps should be migration apply candidates");
assert.deepEqual(classified.classification.admin_tools.system_layer_replacement_present, ["activation_sheets_bootstrap_read"], "system-layer replacements should be separated");
assert.deepEqual(classified.classification.admin_tools.virtual_replacement_present, ["repo_inspect"], "virtual replacements should be separated");
assert.deepEqual(classified.classification.admin_tools.missing_required_runtime_artifact, ["missing_admin_tool"], "true missing admin tools should remain explicit");
assert.deepEqual(classified.classification.tenant_tools.missing_required_runtime_artifact, ["tenant_missing_tool"], "tenant tool gaps should remain explicit");
assert.deepEqual(classified.classification.engines.migration_apply_candidate, ["commercial_lifecycle_engine"], "engine gaps should be migration apply candidates");

const dryRunPlan = buildMigrationDriftApplyPlan(
  {
    schema_objects: ["cms_sites"],
    admin_tools: ["missing_admin_tool"],
    engines: ["commercial_lifecycle_engine"],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  },
  classified,
  {
    schema_objects: { cms_sites: ["162_sprint66_cms_site_resource_access_grants.sql"] },
    admin_tools: { missing_admin_tool: ["051_sprint48_cloudflare_and_self_repair_tools.sql"] },
    engines: { commercial_lifecycle_engine: ["168_sprint65_database_table_lifecycle_governance.sql"] },
  }
);
assert.equal(dryRunPlan.mode, "dry_run", "apply plan must be dry-run only");
assert.equal(dryRunPlan.applies_sql, false, "apply plan must not apply SQL");
assert(dryRunPlan.candidate_files.includes("162_sprint66_cms_site_resource_access_grants.sql"), "must map schema object to source migration file");
assert(dryRunPlan.candidate_files.includes("168_sprint65_database_table_lifecycle_governance.sql"), "must map engine to source migration file");
assert.deepEqual(
  dryRunPlan.admin_tool_review[0],
  {
    item_key: "missing_admin_tool",
    source_files: ["051_sprint48_cloudflare_and_self_repair_tools.sql"],
    recommended_action: "review_registry_tool_surface_or_reseed_specific_tool",
  },
  "missing admin tools should be review items, not automatic SQL apply"
);

const passPreflight = assessMigrationSqlPreflight(
  "safe.sql",
  "CREATE TABLE IF NOT EXISTS cms_sites (site_id varchar(36) PRIMARY KEY); INSERT IGNORE INTO admin_platform_endpoint_tools (tool_key) VALUES ('safe_tool');"
);
assert.equal(passPreflight.status, "pass", "idempotent create table and insert ignore should pass");
assert.equal(passPreflight.counts.create_table_idempotent, 1, "must count idempotent CREATE TABLE");
assert.equal(passPreflight.counts.insert_idempotent, 1, "must count idempotent INSERT");

const warnPreflight = assessMigrationSqlPreflight(
  "warn.sql",
  "CREATE TABLE cms_sites (site_id varchar(36) PRIMARY KEY); INSERT INTO admin_platform_endpoint_tools (tool_key) VALUES ('unsafe_tool');"
);
assert.equal(warnPreflight.status, "warn", "non-idempotent create and insert should warn");
assert(warnPreflight.risks.some((risk) => risk.code === "create_table_without_if_not_exists"), "must flag non-idempotent CREATE TABLE");
assert(warnPreflight.risks.some((risk) => risk.code === "insert_without_ignore_or_on_duplicate"), "must flag non-idempotent INSERT");

const literalPreflight = assessMigrationSqlPreflight(
  "literal.sql",
  "INSERT IGNORE INTO skill_manifests (skill_key, description) VALUES ('drop_truncate_delete_forbidden', 'DROP/TRUNCATE/DELETE are explicitly outside policy');"
);
assert.equal(literalPreflight.status, "pass", "destructive words inside INSERT payload strings should not fail preflight");
assert.equal(literalPreflight.counts.destructive, 0, "must not count destructive words inside string payloads");

const failPreflight = assessMigrationSqlPreflight("danger.sql", "DROP TABLE cms_sites;");
assert.equal(failPreflight.status, "fail", "destructive SQL should fail preflight");
assert(failPreflight.risks.some((risk) => risk.code === "destructive_statement_detected"), "must flag destructive SQL");

console.log("release readiness migration drift parser tests passed");
