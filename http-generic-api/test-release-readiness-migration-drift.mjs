import assert from "node:assert/strict";
import {
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

console.log("release readiness migration drift parser tests passed");
