import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  actionableMigrationDriftCounts,
  assessMigrationSqlPreflight,
  buildMigrationDriftApplyPlan,
  classifyMigrationDriftMissing,
  extractMigrationReadinessRequirementsFromSql,
  extractNamedToolKeysFromSource,
  splitSqlStatements,
} from "./releaseReadiness.js";

function executableSql(statement) {
  return String(statement || "")
    .replace(/^(?:(?:\s*--[^\r\n]*(?:\r?\n|$))|(?:\s*\/\*[\s\S]*?\*\/))*\s*/u, "");
}

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
const backtickedInsertRequirements = extractMigrationReadinessRequirementsFromSql(`
INSERT INTO \`admin_platform_endpoint_tools\`
  (\`tool_key\`, \`display_name\`, \`description\`, \`http_method\`, \`http_path\`)
VALUES
  ('backticked_admin_tool', 'Backticked Tool', 'Read-only.', 'GET', '/admin/backticked')
ON DUPLICATE KEY UPDATE
  \`display_name\` = VALUES(\`display_name\`);
`);

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
assert(backtickedInsertRequirements.admin_tools.includes("backticked_admin_tool"), "must detect admin tool tuple when table and columns use backticks");

const stringLiteralRequirements = extractMigrationReadinessRequirementsFromSql(`
UPDATE execution_policies
SET policy_value = JSON_OBJECT(
  'safe_additive_operations', JSON_ARRAY('CREATE TABLE IF NOT EXISTS registry guard table')
)
WHERE policy_key = 'safe_additive_repair_preferred_over_omission';
`);
assert(!stringLiteralRequirements.schema_objects.includes("registry"), "must not detect CREATE TABLE phrases inside SQL string literals as schema objects");

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
    admin_tools: ["activation_sheets_bootstrap_read", "repo_inspect", "route_present_tool", "documented_route_tool", "missing_admin_tool"],
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
    live_route_paths: ["/live/route"],
    documented_paths: ["/documented/route"],
  },
  {
    admin_tools: {
      route_present_tool: { http_path: "/live/route" },
      documented_route_tool: { http_path: "/documented/route" },
    },
  }
);
assert.deepEqual(classified.classification.schema_objects.migration_apply_candidate, ["cms_sites"], "schema gaps should be migration apply candidates");
assert.deepEqual(classified.classification.admin_tools.deprecated_replaced_by_db_bootstrap, ["activation_sheets_bootstrap_read"], "legacy Sheets bootstrap drift should be classified as DB-bootstrap replaced");
assert.equal(classified.classification.admin_tools.system_layer_replacement_present, undefined, "deprecated DB-bootstrap replacements should not be reported as generic system-layer replacements");
assert.deepEqual(classified.classification.admin_tools.virtual_replacement_present, ["repo_inspect"], "virtual replacements should be separated");
assert.deepEqual(classified.classification.admin_tools.live_route_registry_exposure_missing, ["route_present_tool"], "live route tools should be separated from hard missing runtime artifacts");
assert.deepEqual(classified.classification.admin_tools.documented_route_registry_exposure_missing, ["documented_route_tool"], "documented route tools should be separated from hard missing runtime artifacts");
assert.deepEqual(classified.classification.admin_tools.missing_required_runtime_artifact, ["missing_admin_tool"], "true missing admin tools should remain explicit");
assert.deepEqual(classified.classification.tenant_tools.missing_required_runtime_artifact, ["tenant_missing_tool"], "tenant tool gaps should remain explicit");
assert.deepEqual(classified.classification.engines.migration_apply_candidate, ["commercial_lifecycle_engine"], "engine gaps should be migration apply candidates");
const actionableReplacementOnly = actionableMigrationDriftCounts(
  {
    schema_objects: [],
    admin_tools: ["activation_sheets_bootstrap_read"],
    tenant_tools: [],
    engines: [],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  },
  {
    counts: {
      admin_tools: { deprecated_replaced_by_db_bootstrap: 1 },
    },
  }
);
assert.equal(actionableReplacementOnly.total, 0, "DB-bootstrap replaced drift should not be actionable");

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

const splitStatements = splitSqlStatements(
  "CREATE TABLE IF NOT EXISTS cms_sites (site_id varchar(36) PRIMARY KEY); INSERT IGNORE INTO admin_platform_endpoint_tools (tool_key, description) VALUES ('safe_tool', 'text with semicolon; not a boundary'); INSERT IGNORE INTO admin_platform_endpoint_tools (tool_key) VALUES ('safe_tool_2');"
);
assert.equal(splitStatements.length, 3, "must split SQL on statement boundaries while preserving semicolons inside string literals");
assert(splitStatements[1].includes("semicolon; not a boundary"), "must keep semicolon literals inside the INSERT statement");

const commentSeparatedStatements = splitSqlStatements(
  "UPDATE admin_platform_endpoint_tools SET description = 'ok' WHERE tool_key = 'admin_control';\n\n-- next seed block\nINSERT INTO admin_platform_endpoint_tools (tool_key) VALUES ('seeded_tool') ON DUPLICATE KEY UPDATE tool_key = VALUES(tool_key);\n/* next block */\nINSERT IGNORE INTO admin_platform_endpoint_tools (tool_key) VALUES ('seeded_tool_2');"
);
assert.equal(commentSeparatedStatements.length, 3, "must split SQL across line/block comments between statements");
assert(commentSeparatedStatements[0].startsWith("UPDATE"), "must treat UPDATE as a statement boundary");
assert(commentSeparatedStatements[1].startsWith("INSERT INTO"), "must split after comments before INSERT INTO");
assert(commentSeparatedStatements[2].startsWith("INSERT IGNORE INTO"), "must split after block comments before INSERT IGNORE INTO");

const leadingCommentStatements = splitSqlStatements(
  "-- migration identity\n/* governed scope */\nUPDATE execution_enablement_requests SET request_status = 'expired' WHERE request_status = 'pending_approval';"
);
assert(leadingCommentStatements[0].startsWith("-- migration identity"), "statement splitting must preserve leading source comments for evidence");
assert(executableSql(leadingCommentStatements[0]).startsWith("UPDATE execution_enablement_requests"), "executable statement inspection must ignore preserved leading comments");

const proceduralStatements = splitSqlStatements(`
UPDATE execution_enablement_requests SET request_status = 'expired' WHERE request_status = 'pending_approval';
CREATE TEMPORARY TABLE tmp_statement_splitter_guard AS SELECT 1 AS ok;
SET @statement_splitter_sql := 'SELECT 1 AS prepared_ok';
PREPARE statement_splitter_stmt FROM @statement_splitter_sql;
EXECUTE statement_splitter_stmt;
DEALLOCATE PREPARE statement_splitter_stmt;
DROP TEMPORARY TABLE tmp_statement_splitter_guard;
`);
assert.equal(proceduralStatements.length, 7, "must split MariaDB temporary-table and prepared-statement migration commands");
assert(proceduralStatements[1].startsWith("CREATE TEMPORARY TABLE"), "must split CREATE TEMPORARY TABLE from the preceding UPDATE");
assert(proceduralStatements[2].startsWith("SET @statement_splitter_sql"), "must split SET user-variable statements");
assert(proceduralStatements[3].startsWith("PREPARE statement_splitter_stmt"), "must split PREPARE statements");
assert(proceduralStatements[4].startsWith("EXECUTE statement_splitter_stmt"), "must split EXECUTE statements");
assert(proceduralStatements[5].startsWith("DEALLOCATE PREPARE statement_splitter_stmt"), "must split DEALLOCATE PREPARE statements");
assert(proceduralStatements[6].startsWith("DROP TEMPORARY TABLE"), "must split DROP TEMPORARY TABLE statements");

const passSql = "-- leading migration comment\nCREATE TABLE IF NOT EXISTS cms_sites (site_id varchar(36) PRIMARY KEY); INSERT IGNORE INTO admin_platform_endpoint_tools (tool_key) VALUES ('safe_tool');";
const passPreflight = assessMigrationSqlPreflight("safe.sql", passSql);
assert.equal(passPreflight.counts.statements, splitSqlStatements(passSql).length, "preflight must use the same statement splitter as apply");
assert.equal(passPreflight.status, "pass", "idempotent create table and insert ignore should pass");
assert.equal(passPreflight.counts.create_table_idempotent, 1, "must count idempotent CREATE TABLE");
assert.equal(passPreflight.counts.insert_idempotent, 1, "must count idempotent INSERT");

const mariaDbJsonCastPreflight = assessMigrationSqlPreflight(
  "mariadb-json-cast.sql",
  "UPDATE admin_platform_endpoint_tools SET input_schema = JSON_SET(CAST(input_schema AS JSON), '$.properties.authority_context', JSON_OBJECT('type','object')) WHERE tool_key = 'admin_control';"
);
assert.equal(mariaDbJsonCastPreflight.status, "fail", "MariaDB-incompatible CAST(... AS JSON) must fail before execution");
assert(
  mariaDbJsonCastPreflight.risks.some((risk) => risk.code === "mariadb_cast_as_json_not_supported"),
  "must flag MariaDB-incompatible JSON casts"
);

const unknownRegistryColumnPreflight = assessMigrationSqlPreflight(
  "unknown-registry-column.sql",
  "INSERT INTO tenant_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path) VALUES ('bad_tool', 'Bad', 'Bad.', 'GET', '/bad') ON DUPLICATE KEY UPDATE missing_column = VALUES(display_name);"
);
assert.equal(unknownRegistryColumnPreflight.status, "fail", "unknown ON DUPLICATE registry columns must fail before partial apply");
assert(
  unknownRegistryColumnPreflight.risks.some((risk) => risk.code === "on_duplicate_update_unknown_column" && risk.table === "tenant_platform_endpoint_tools" && risk.column === "missing_column"),
  "must flag unknown tenant registry duplicate-update columns"
);

const knownRegistryColumnPreflight = assessMigrationSqlPreflight(
  "known-registry-column.sql",
  "INSERT INTO tenant_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path) VALUES ('good_tool', 'Good', 'Good.', 'GET', '/good') ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP, display_name = VALUES(display_name);"
);
assert.equal(knownRegistryColumnPreflight.status, "pass", "known tenant registry duplicate-update columns should pass");

const guardedInsertSelectPreflight = assessMigrationSqlPreflight(
  "guarded-insert-select.sql",
  "INSERT INTO policy_logic_bindings (source_policy_id) SELECT ep.id FROM execution_policies ep WHERE ep.active = 'TRUE' AND NOT EXISTS (SELECT 1 FROM policy_logic_bindings b WHERE b.source_policy_id = ep.id);"
);
assert.equal(guardedInsertSelectPreflight.status, "pass", "INSERT SELECT guarded by NOT EXISTS should pass as idempotent");
assert.equal(guardedInsertSelectPreflight.counts.insert_idempotent, 1, "must count NOT EXISTS-guarded INSERT SELECT as idempotent");

const guardedUpdatePreflight = assessMigrationSqlPreflight(
  "guarded-update.sql",
  "UPDATE execution_plans SET workflow_id = 'wf.example' WHERE workflow_id IS NULL;"
);
assert.equal(guardedUpdatePreflight.status, "pass", "UPDATE guarded by WHERE should pass preflight");
assert.equal(guardedUpdatePreflight.counts.update, 1, "must count UPDATE statements");
assert.equal(guardedUpdatePreflight.counts.update_guarded, 1, "must count WHERE-guarded UPDATE statements");

const unguardedUpdatePreflight = assessMigrationSqlPreflight(
  "unguarded-update.sql",
  "UPDATE execution_plans SET workflow_id = 'wf.example';"
);
assert.equal(unguardedUpdatePreflight.status, "warn", "UPDATE without WHERE should warn");
assert(
  unguardedUpdatePreflight.risks.some((risk) => risk.code === "update_without_where"),
  "must flag UPDATE without WHERE"
);

const subqueryOnlyGuardUpdatePreflight = assessMigrationSqlPreflight(
  "subquery-only-guard-update.sql",
  "UPDATE execution_plans ep JOIN (SELECT workflow_key FROM workflows WHERE active = 1) wf ON wf.workflow_key = ep.workflow_key SET ep.workflow_id = wf.workflow_key;"
);
assert.equal(subqueryOnlyGuardUpdatePreflight.status, "warn", "UPDATE must not treat a subquery WHERE as a target-row guard");
assert.equal(subqueryOnlyGuardUpdatePreflight.counts.update_guarded, 0, "must require a top-level UPDATE WHERE clause");

const commentOnlyGuardUpdatePreflight = assessMigrationSqlPreflight(
  "comment-only-guard-update.sql",
  "UPDATE execution_plans SET workflow_id = 'wf.example' -- WHERE workflow_id IS NULL"
);
assert.equal(commentOnlyGuardUpdatePreflight.status, "warn", "UPDATE must not treat an inline-comment WHERE as a target-row guard");
assert.equal(commentOnlyGuardUpdatePreflight.counts.update_guarded, 0, "must ignore inline comments when finding a top-level WHERE");

const workflowIdentityBackfillSql = readFileSync(
  new URL("migrations/209_sprint67_execution_plan_workflow_identity_backfill.sql", import.meta.url),
  "utf8"
);
const workflowIdentityBackfillPreflight = assessMigrationSqlPreflight(
  "209_sprint67_execution_plan_workflow_identity_backfill.sql",
  workflowIdentityBackfillSql
);
assert.equal(workflowIdentityBackfillPreflight.status, "pass", "workflow identity backfill must pass governed migration preflight");
assert.equal(workflowIdentityBackfillPreflight.counts.statements, 1, "workflow identity backfill must remain one bounded UPDATE");
assert.equal(workflowIdentityBackfillPreflight.counts.update_guarded, 1, "workflow identity backfill must retain a top-level WHERE guard");

const idempotentAlterPreflight = assessMigrationSqlPreflight(
  "idempotent-alter.sql",
  "ALTER TABLE admin_platform_endpoint_tools ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;"
);
assert.equal(idempotentAlterPreflight.status, "pass", "ADD COLUMN IF NOT EXISTS should pass as an idempotent additive ALTER");
assert.equal(idempotentAlterPreflight.counts.alter_table, 1, "must count ALTER TABLE statements");
assert.equal(idempotentAlterPreflight.counts.alter_table_idempotent, 1, "must count idempotent ADD COLUMN IF NOT EXISTS");

const indexStatements = splitSqlStatements(
  "ALTER TABLE execution_plans ADD COLUMN IF NOT EXISTS workflow_id VARCHAR(191) NULL; CREATE INDEX IF NOT EXISTS idx_execution_plans_workflow_id ON execution_plans (workflow_id);"
);
assert.equal(indexStatements.length, 2, "must split CREATE INDEX from the preceding migration statement");
const idempotentIndexPreflight = assessMigrationSqlPreflight("idempotent-index.sql", indexStatements.join("; "));
assert.equal(idempotentIndexPreflight.status, "pass", "CREATE INDEX IF NOT EXISTS should pass preflight");
assert.equal(idempotentIndexPreflight.counts.create_index, 1, "must count CREATE INDEX statements");
assert.equal(idempotentIndexPreflight.counts.create_index_idempotent, 1, "must count idempotent CREATE INDEX");

const tagsWideningPreflight = assessMigrationSqlPreflight(
  "tags-text.sql",
  "ALTER TABLE admin_platform_endpoint_tools MODIFY COLUMN tags TEXT NULL;"
);
assert.equal(tagsWideningPreflight.status, "pass", "admin tool registry tags widening to TEXT should pass as a safe non-destructive ALTER");
assert.equal(tagsWideningPreflight.counts.alter_table, 1, "must count tags widening ALTER TABLE");
assert.equal(tagsWideningPreflight.counts.alter_table_idempotent, 1, "must count approved tags widening as idempotent/safe ALTER");

const ephemeralCheckoutMigrationName = "20260728_operation_managed_git_ephemeral_checkout.sql";
const ephemeralCheckoutMigration = readFileSync(
  new URL(`migrations/${ephemeralCheckoutMigrationName}`, import.meta.url),
  "utf8"
);
const ephemeralCheckoutPreflight = assessMigrationSqlPreflight(
  ephemeralCheckoutMigrationName,
  ephemeralCheckoutMigration
);
assert.equal(ephemeralCheckoutPreflight.status, "pass", "reviewed Spec 011 enum widening must pass governed migration preflight");
assert.equal(ephemeralCheckoutPreflight.risk_count, 0, "reviewed Spec 011 enum widening must have zero preflight risks");
assert.equal(ephemeralCheckoutPreflight.counts.statements, 1, "Spec 011 enum widening must remain one bounded statement");
assert.equal(ephemeralCheckoutPreflight.counts.alter_table, 1, "Spec 011 enum widening must remain an ALTER TABLE");
assert.equal(ephemeralCheckoutPreflight.counts.alter_table_idempotent, 1, "the exact reviewed Spec 011 ALTER must be counted as approved/idempotent");

const unboundEphemeralCheckoutPreflight = assessMigrationSqlPreflight(
  "unreviewed-ephemeral-checkout.sql",
  ephemeralCheckoutMigration
);
assert.equal(unboundEphemeralCheckoutPreflight.status, "warn", "the same ALTER under another migration identity must remain review-gated");
assert(
  unboundEphemeralCheckoutPreflight.risks.some((risk) => risk.code === "alter_table_requires_manual_idempotency_review"),
  "unbound enum ALTER must retain the manual idempotency review warning"
);

const approvalHoldCollationMigrationName = "1013_sprint69_approval_hold_identity_collation_alignment.sql";
const approvalHoldCollationMigration = readFileSync(
  new URL(`migrations/${approvalHoldCollationMigrationName}`, import.meta.url),
  "utf8"
);
const approvalHoldCollationPreflight = assessMigrationSqlPreflight(
  approvalHoldCollationMigrationName,
  approvalHoldCollationMigration
);
assert.equal(approvalHoldCollationPreflight.status, "pass", "migration 1013 idempotent collation alignment must pass preflight");
assert.equal(approvalHoldCollationPreflight.risk_count, 0, "migration 1013 dynamic ALTER contracts must not create top-level ALTER warnings");
assert.equal(approvalHoldCollationPreflight.counts.alter_table, 0, "migration 1013 ALTERs must remain guarded dynamic SQL rather than top-level statements");
const approvalHoldCollationStatements = splitSqlStatements(approvalHoldCollationMigration);
assert.equal(approvalHoldCollationStatements.length, 26, "migration 1013 must split into 26 independently executable statements");
assert.equal(approvalHoldCollationPreflight.counts.statements, 26, "migration 1013 preflight and apply must share the 26-statement boundary contract");
assert(executableSql(approvalHoldCollationStatements[0]).startsWith("UPDATE execution_enablement_requests"), "migration 1013 first executable statement must remain the bounded orphan cleanup UPDATE");
assert(approvalHoldCollationStatements[1].startsWith("CREATE TEMPORARY TABLE tmp_approval_hold_identity_orphans"), "migration 1013 temporary orphan table must be a separate statement");
assert(approvalHoldCollationStatements.at(-2).startsWith("CREATE OR REPLACE VIEW v_approval_hold_identity_collation_readiness"), "migration 1013 readiness view must be independently executable");
assert(approvalHoldCollationStatements.at(-1).startsWith("INSERT INTO execution_policies"), "migration 1013 policy seed must be the final independent statement");
assert.equal(
  approvalHoldCollationMigration.split("COLLATE utf8mb4_unicode_ci AS hold_id").length - 1,
  9,
  "all nine migration 1013 orphan UNION projections must normalize hold_id to utf8mb4_unicode_ci"
);

const approvalHoldDynamicAlterContracts = [
  "ALTER TABLE local_gateway_tool_call_log MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL",
  "ALTER TABLE repository_advisory_comment_plans MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL",
  "ALTER TABLE ticket_workflow_links MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL",
  "ALTER TABLE approval_holds MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
];
for (const contract of approvalHoldDynamicAlterContracts) {
  assert(approvalHoldCollationMigration.includes(`ELSE '${contract}'`), `migration 1013 must retain the guarded dynamic contract: ${contract}`);
}
assert.equal(
  approvalHoldCollationMigration.split("ELSE 'ALTER TABLE ").length - 1,
  4,
  "migration 1013 must retain exactly four guarded dynamic ALTER contracts"
);
assert.equal(
  approvalHoldCollationMigration.split("FROM information_schema.columns").length - 1,
  4,
  "each migration 1013 dynamic ALTER contract must be selected through information_schema"
);
assert.equal(
  approvalHoldCollationMigration.split("\nPREPARE align_").length - 1,
  4,
  "each migration 1013 dynamic ALTER contract must execute through its bounded prepared statement"
);

const approvalHoldDirectAlterPreflight = assessMigrationSqlPreflight(
  approvalHoldCollationMigrationName,
  "ALTER TABLE approval_holds MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;"
);
assert.equal(approvalHoldDirectAlterPreflight.status, "warn", "a direct migration 1013 ALTER must still require manual idempotency review");

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
